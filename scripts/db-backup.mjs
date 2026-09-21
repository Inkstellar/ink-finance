#!/usr/bin/env node
/**
 * Back up (and, deliberately, restore) the ink-finance database.
 *
 *   npm run db:backup                          # dump every fin_* table
 *   npm run db:backup -- --out path.json       # choose the file
 *   npm run db:backup -- --inspect path.json   # read a backup, touch nothing
 *   npm run db:backup -- --restore path.json --yes
 *
 * WHY THIS EXISTS
 * On 2026-09-21 a set of loans was found to be unrecoverable, and every route
 * back turned out to be closed:
 *   - `pageinspect` needs superuser, which Neon does not grant, so the deleted
 *     rows could not be read out of the heap even though they were still there;
 *   - Render keeps only a few hours of deploy logs and does not log requests;
 *   - the point-in-time window is a branch property, not readable from SQL.
 * The real root cause was simpler than any of that: there was no backup. This
 * script is the fix for the next incident rather than this one.
 *
 * SAFETY
 * Dumping is read-only — SELECT only. Restoring is opt-in twice over: it needs
 * `--restore`, and it needs `--yes`, and it refuses to touch a table that
 * already holds rows unless `--force` is also given. A backup you cannot
 * restore is theatre, so restore is implemented properly, but it will not
 * quietly overwrite live data.
 */
import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  encodeRow,
  decodeRow,
  orderTables,
  makeBackup,
  validateBackup,
  summarise,
} from './backup-format.mjs';

const prisma = new PrismaClient();

// ── Args ────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out.out = argv[++i];
    else if (a === '--restore') out.restore = argv[++i];
    else if (a === '--inspect') out.inspect = argv[++i];
    else if (a === '--yes') out.yes = true;
    else if (a === '--force') out.force = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('--')) out.positional.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`
  Back up and restore the ink-finance database.

    npm run db:backup                            dump to backups/<timestamp>.json
    npm run db:backup -- --out path.json         choose the destination
    npm run db:backup -- --inspect path.json     summarise a backup, change nothing
    npm run db:backup -- --restore path.json --yes
                                                 insert rows back
    npm run db:backup -- --restore path.json --yes --force
                                                 also into tables that have rows

  Dumping is read-only. Restoring requires --yes, and skips any table that
  already contains rows unless --force is given. Conflicts on a primary key are
  ignored (ON CONFLICT DO NOTHING), so a restore never clobbers a live row.

  The output contains real financial data. backups/ is gitignored — keep it out
  of the repository.
`);
  process.exit(0);
}

/** Host and database name, with the password masked. */
function describeSource() {
  const url = process.env.DATABASE_URL || '';
  try {
    const u = new URL(url);
    return { host: u.hostname, database: u.pathname.replace(/^\//, '') };
  } catch {
    return { host: 'unknown', database: 'unknown' };
  }
}

async function listTables() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'fin\\_%'
    ORDER BY table_name`);
  return rows.map((r) => r.table_name);
}

async function columnTypesFor(table) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '${table}'
    ORDER BY ordinal_position`);
  return Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
}

// ── Dump ────────────────────────────────────────────────────
async function dump(outPath) {
  const source = describeSource();
  console.log(`\n  Backing up ${source.database} @ ${source.host}\n`);

  const tables = {};
  const columnTypes = {};

  for (const table of orderTables(await listTables())) {
    const types = await columnTypesFor(table);
    columnTypes[table] = types;
    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`);
    tables[table] = rows.map((r) => encodeRow(r, types));
    console.log(`  ${String(rows.length).padStart(6)}  ${table}`);
  }

  const pkg = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const backup = {
    ...makeBackup({ tables, columnTypes, source, appVersion: pkg.version }),
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(backup, null, 2), 'utf8');

  const total = Object.values(tables).reduce((n, r) => n + r.length, 0);
  const bytes = Buffer.byteLength(JSON.stringify(backup));
  console.log(`\n  ${plural(total)} → ${outPath} (${(bytes / 1024).toFixed(1)} KB)\n`);
}

// ── Inspect ─────────────────────────────────────────────────
async function inspect(file) {
  const data = JSON.parse(await readFile(file, 'utf8'));
  const err = validateBackup(data);
  if (err) {
    console.error(`  ${file} is not a usable backup: ${err}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n  ${file}`);
  console.log(`  taken    ${data.createdAt}`);
  console.log(`  from     ${data.source?.database} @ ${data.source?.host}`);
  console.log(`  version  ${data.appVersion}\n`);
  let total = 0;
  for (const { table, rows } of summarise(data)) {
    total += rows;
    console.log(`  ${String(rows).padStart(6)}  ${table}`);
  }
  console.log(`\n  ${plural(total)} total\n`);
}

// ── Restore ─────────────────────────────────────────────────
/** "1 row" / "2 rows" */
const plural = (n, word = 'row') => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Postgres allows 65535 bound parameters per statement. */
const MAX_PARAMS = 60_000;

async function insertRows(table, rows, types) {
  if (rows.length === 0) return 0;

  const columns = Object.keys(types);
  const perRow = columns.length;
  const chunkSize = Math.max(1, Math.floor(MAX_PARAMS / perRow));
  const columnList = columns.map((c) => `"${c}"`).join(', ');

  let inserted = 0;
  await prisma.$transaction(
    async (tx) => {
      for (let start = 0; start < rows.length; start += chunkSize) {
        const chunk = rows.slice(start, start + chunkSize);
        const values = [];
        const tuples = chunk.map((row) => {
          const placeholders = columns.map((c) => {
            values.push(decodeRow({ [c]: row[c] }, types)[c]);
            return `$${values.length}`;
          });
          return `(${placeholders.join(', ')})`;
        });

        await tx.$executeRawUnsafe(
          `INSERT INTO "${table}" (${columnList}) VALUES ${tuples.join(', ')}
           ON CONFLICT DO NOTHING`,
          ...values,
        );
        inserted += chunk.length;
      }
    },
    { timeout: 120_000 },
  );

  return inserted;
}

async function restore(file, { yes, force }) {
  const data = JSON.parse(await readFile(file, 'utf8'));
  const err = validateBackup(data);
  if (err) {
    console.error(`\n  ${file} is not a usable backup: ${err}\n`);
    process.exitCode = 1;
    return;
  }

  const source = describeSource();
  const taken = new Date(data.createdAt).toISOString();

  console.log(`\n  Restoring ${file}`);
  console.log(`  backup taken ${taken}`);
  console.log(`  target       ${source.database} @ ${source.host}\n`);

  if (!yes) {
    console.error('  Refusing to write without --yes. Nothing was changed.\n');
    process.exitCode = 1;
    return;
  }

  let restored = 0;
  let skipped = 0;

  for (const table of orderTables(Object.keys(data.tables))) {
    const rows = data.tables[table];
    const types = data.columnTypes[table];
    if (!types) {
      console.log(`  ${String(rows.length).padStart(6)}  ${table}  SKIPPED (no column types)`);
      skipped += rows.length;
      continue;
    }

    const [{ n }] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${table}"`,
    );

    if (n > 0 && !force) {
      console.log(
        `  ${String(rows.length).padStart(6)}  ${table}  SKIPPED (already has ${plural(n)})`,
      );
      skipped += rows.length;
      continue;
    }

    const count = await insertRows(table, rows, types);
    restored += count;
    console.log(`  ${String(count).padStart(6)}  ${table}`);
  }

  console.log(`\n  ${plural(restored)} restored, ${skipped} skipped.\n`);
  if (skipped > 0 && !force) {
    console.log('  Re-run with --force to write into the non-empty tables too.\n');
  }
}

// ── Main ────────────────────────────────────────────────────
function defaultOutPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join('backups', `ink-finance-${stamp}.json`);
}

try {
  if (args.inspect) {
    await inspect(args.inspect);
  } else if (args.restore) {
    await restore(args.restore, { yes: args.yes, force: args.force });
  } else {
    await dump(args.out || defaultOutPath());
  }
} catch (e) {
  console.error('\n  FAILED:', e.message, '\n');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
