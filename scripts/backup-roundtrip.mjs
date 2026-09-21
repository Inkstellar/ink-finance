#!/usr/bin/env node
/**
 * Prove that a backup can actually be RESTORED — not just written.
 *
 *   npm run test:backup-restore
 *
 * Why this exists: `npm run test:backup` tests the pure encoder, and the first
 * live run of `db:backup` only ever exercised the *skip* path (every non-empty
 * table was skipped, every empty table had zero rows). So `insertRows()` — the
 * code that actually puts data back — had never run against a real database. A
 * backup whose restore is untested is theatre.
 *
 * How it stays safe: it works exclusively on a throwaway probe table named
 * `fin_zzrestore_probe`, which it creates and drops in a `finally`. It never
 * writes to a real `fin_*` table — the restore run picks up the whole database,
 * but every real table either already has rows (so it is skipped) or has none
 * in the backup (so nothing is inserted).
 *
 * Deliberately NOT in CI: like the other DB-backed smoke tests it needs the
 * real database, and `ci.yml` is kept secret-free.
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const PROBE = 'fin_zzrestore_probe';
const FILE = '/tmp/ink-finance-restore-probe.json';

const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

/** Run the CLI the same way a user would. */
function cli(args) {
  return execFileSync('node', ['scripts/db-backup.mjs', ...args], {
    encoding: 'utf8',
    env: process.env,
  });
}

// The fixtures deliberately include the awkward types: a UTC-midnight date (the
// app's convention), a bigint, a bytea blob, and a row of nulls.
const ROWS = [
  {
    id: 'probe-1',
    label: 'Vodafone bill',
    day: new Date('2026-09-21T00:00:00.000Z'),
    amount: 4999,
    hits: 9007199254740993n,
    blob: Buffer.from([0x00, 0x01, 0xff, 0xfe]),
    note: null,
  },
  {
    id: 'probe-2',
    label: null,
    day: new Date('2026-01-01T00:00:00.000Z'),
    amount: 0,
    hits: 0n,
    blob: null,
    note: 'a note with an apostrophe: it\'s fine',
  },
];

async function setup() {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${PROBE}"`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${PROBE}" (
      id     TEXT PRIMARY KEY,
      label  TEXT,
      day    TIMESTAMP(3) NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      hits   BIGINT NOT NULL,
      blob   BYTEA,
      note   TEXT
    )`);

  for (const r of ROWS) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${PROBE}" (id, label, day, amount, hits, blob, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      r.id, r.label, r.day, r.amount, r.hits, r.blob, r.note,
    );
  }
}

async function readProbe() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, label, day, amount, hits, blob, note FROM "${PROBE}" ORDER BY id`,
  );
  return rows;
}

/** Compare a restored row against its fixture, type by type. */
function sameRow(got, want) {
  if (got.id !== want.id) return `id ${got.id}`;
  if (got.label !== want.label) return `label ${got.label}`;
  if (!(got.day instanceof Date)) return 'day is not a Date';
  if (got.day.getTime() !== want.day.getTime()) {
    return `day ${got.day.toISOString()} vs ${want.day.toISOString()}`;
  }
  if (got.amount !== want.amount) return `amount ${got.amount}`;
  if (typeof got.hits !== 'bigint') return 'hits is not a bigint';
  if (got.hits !== want.hits) return `hits ${got.hits}`;
  if (want.blob === null) {
    if (got.blob !== null) return `blob ${got.blob}`;
  } else {
    if (!Buffer.isBuffer(got.blob)) return 'blob is not a Buffer';
    if (!got.blob.equals(want.blob)) return `blob ${got.blob.toString('hex')}`;
  }
  if (got.note !== want.note) return `note ${got.note}`;
  return null;
}

async function main() {
  console.log('\n  backup → restore round trip\n');

  try {
    await setup();
    check('the probe table is populated', (await readProbe()).length === ROWS.length);

    // ── Dump ────────────────────────────────────────────────
    const dumpOut = cli(['--out', FILE]);
    check('the dump reports the probe table', dumpOut.includes(PROBE));

    const backup = JSON.parse(readFileSync(FILE, 'utf8'));
    const dumped = backup.tables[PROBE];
    check('the probe rows are in the backup', dumped?.length === ROWS.length,
      `${dumped?.length} rows`);
    check('the backup records the probe column types',
      backup.columnTypes[PROBE]?.day === 'timestamp without time zone',
      backup.columnTypes[PROBE]?.day);
    check('a bigint is encoded as a string',
      typeof dumped?.[0]?.hits === 'string', typeof dumped?.[0]?.hits);
    check('a bytea value is encoded as a marker',
      typeof dumped?.[0]?.blob === 'object' && dumped?.[0]?.blob !== null);
    check('a date is encoded as a UTC ISO string',
      dumped?.[0]?.day === '2026-09-21T00:00:00.000Z', dumped?.[0]?.day);

    // ── Wipe, then restore ─────────────────────────────────
    await prisma.$executeRawUnsafe(`DELETE FROM "${PROBE}"`);
    check('the probe table is empty before the restore',
      (await readProbe()).length === 0);

    const restoreOut = cli(['--restore', FILE, '--yes']);
    check('the restore reports rows restored', /2 rows restored/.test(restoreOut),
      restoreOut.split('\n').filter((l) => /restored/.test(l)).join(' ').trim());

    // ── Compare ────────────────────────────────────────────
    const after = await readProbe();
    check('both rows came back', after.length === ROWS.length, `${after.length} rows`);

    for (const want of ROWS) {
      const got = after.find((r) => r.id === want.id);
      if (!got) {
        check(`row ${want.id} survived`, false, 'missing');
        continue;
      }
      const diff = sameRow(got, want);
      check(`row ${want.id} round-tripped exactly`, diff === null, diff || '');
    }

    // The whole point: the date is the same instant, not the same wall clock.
    const restored = after.find((r) => r.id === 'probe-1');
    check('the date is still the intended calendar day',
      restored?.day?.toISOString() === '2026-09-21T00:00:00.000Z',
      restored?.day?.toISOString());
    check('the large bigint kept every digit',
      restored?.hits === 9007199254740993n, String(restored?.hits));

    // ── A second restore must not duplicate ────────────────
    const again = cli(['--restore', FILE, '--yes']);
    check('a second restore skips the now-populated table',
      /0 rows restored/.test(again), again.split('\n').filter((l) => /restored/.test(l)).join(' ').trim());
    check('and does not duplicate the rows',
      (await readProbe()).length === ROWS.length);
  } catch (e) {
    check('the round trip ran without throwing', false, e.message);
  } finally {
    try {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${PROBE}"`);
      console.log(`\n  probe table dropped`);
    } catch (e) {
      console.log(`\n  ⚠️  could not drop the probe table: ${e.message}`);
    }
    try { rmSync(FILE); } catch { /* nothing to remove */ }
    await prisma.$disconnect();
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
