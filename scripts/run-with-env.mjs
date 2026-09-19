#!/usr/bin/env node
/**
 * Run a command with environment variables loaded from one or more dotenv files.
 *
 *   node scripts/run-with-env.mjs <env-file...> -- <command> [args...]
 *
 * Files are loaded left-to-right and **later files win**, so you can layer a
 * shared base (`.env.local` — secrets) underneath a profile (`.env.render` —
 * deployed URLs) without copying secrets into the repo.
 *
 * Why not the alternatives?
 *   - `node --env-file` only applies to a Node entrypoint. Our commands are
 *     CLI wrappers (`tsx`, `vite`), which don't get the flag.
 *   - `dotenv-cli` / `cross-env` would be a new dependency for ~60 lines.
 *
 * Also prints what it loaded, which makes "why is my API URL wrong?" obvious.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

// ── Parse argv ──────────────────────────────────────────────
const argv = process.argv.slice(2);
const sep = argv.indexOf('--');

if (sep === -1 || sep === argv.length - 1) {
  console.error(
    'Usage: node scripts/run-with-env.mjs <env-file...> -- <command> [args...]',
  );
  console.error(
    'Example: node scripts/run-with-env.mjs .env.local .env.render -- tsx telegram-bot/index.ts',
  );
  process.exit(2);
}

const files = argv
  .slice(0, sep)
  .flatMap((a) => a.split(','))
  .map((s) => s.trim())
  .filter(Boolean);

const [command, ...commandArgs] = argv.slice(sep + 1);

// ── Load the files ──────────────────────────────────────────
const looksSecret = /(TOKEN|KEY|SECRET|PASSWORD|PASS|DATABASE_URL|CREDENTIAL)/i;

function mask(value) {
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 3)}…${value.slice(-3)} (${value.length} chars)`;
}

/** key -> the file that finally set it */
const effective = new Map();
let anyLoaded = false;

for (const file of files) {
  const abs = resolve(process.cwd(), file);

  if (!existsSync(abs)) {
    console.warn(`  ⚠️  ${file} — not found, skipped`);
    continue;
  }

  const { parsed } = dotenv.config({ path: abs, override: true, quiet: true });
  const keys = Object.keys(parsed ?? {});
  anyLoaded = true;

  const shadowed = keys.filter(
    (k) => effective.has(k) && effective.get(k) !== file,
  );
  keys.forEach((k) => effective.set(k, file));

  const note = shadowed.length ? `  ↳ overrides ${shadowed.join(', ')}` : '';
  console.log(
    `  ✓ ${file} — ${keys.length} var${keys.length === 1 ? '' : 's'}${note}`,
  );
}

if (!anyLoaded) {
  console.error('\n✗ No env files could be loaded. Aborting.\n');
  process.exit(1);
}

console.log('  effective:');
for (const [key, file] of effective) {
  const value = process.env[key] ?? '';
  const shown = looksSecret.test(key) ? mask(value) : value;
  console.log(`      ${key}=${shown}   ← ${file}`);
}
console.log('');

// ── Spawn, forwarding signals ───────────────────────────────
// npm puts node_modules/.bin on PATH for `npm run` scripts, but not when this
// file is invoked directly (`node scripts/run-with-env.mjs … -- vite`). Prefer
// the local shim so both call styles work.
const localBin = resolve(process.cwd(), 'node_modules', '.bin', command);
const executable = existsSync(localBin) ? localBin : command;

const child = spawn(executable, commandArgs, {
  stdio: 'inherit',
  env: process.env,
  // Windows needs a shell to resolve the `.cmd` shims npm creates.
  shell: process.platform === 'win32',
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    child.kill(signal);
  });
}

child.on('error', (err) => {
  console.error(`✗ Could not start "${command}": ${err.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  // Ctrl+C on a dev server is the normal way to stop it — don't turn that into
  // a non-zero exit that npm reports as an ELIFECYCLE failure.
  if (signal === 'SIGINT' || signal === 'SIGTERM') process.exit(0);
  process.exit(code ?? 1);
});
