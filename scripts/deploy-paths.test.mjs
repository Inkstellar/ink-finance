/**
 * Exercises the file-classification block inside
 * .github/workflows/deploy.yml, extracted from the file itself so the test
 * cannot drift away from what actually runs in CI.
 *
 *   node scripts/deploy-paths.test.mjs
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');

// Pull out the `case` block verbatim, between the read loop and the done.
const start = workflow.indexOf('while IFS= read -r f; do');
const end = workflow.indexOf('done <<< "$files"');
if (start === -1 || end === -1) {
  console.error('Could not find the classification loop in deploy.yml — did it get refactored?');
  process.exit(1);
}
const classifier = workflow.slice(workflow.indexOf('\n', start) + 1, end);

/** Run the real classifier over a list of changed files. */
function classify(files) {
  // The classifier is the body of the loop, so it is wrapped back up in the
  // same loop the workflow uses. The file list goes in as a quoted heredoc —
  // a double-quoted string would leave the newlines escaped and collapse the
  // list into one bogus path.
  const script = `set -euo pipefail
web=false; api=false; bot=false; ignored=0
while IFS= read -r f; do
${classifier}
done <<'FILELIST'
${files.join('\n')}
FILELIST
echo "$web $api $bot"`;
  const out = execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim();
  const [web, api, bot] = out.split(' ');
  return { web: web === 'true', api: api === 'true', bot: bot === 'true' };
}

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

const expect = (name, files, want) => {
  const got = classify(files);
  const same = got.web === want.web && got.api === want.api && got.bot === want.bot;
  check(name, same, same ? '' : `got web=${got.web} api=${got.api} bot=${got.bot}`);
};

console.log('\n  deploy.yml path classification\n');

// ── Targeted changes ───────────────────────────────────────
expect('a page edit deploys web only',
  ['src/pages/Transactions.tsx'], { web: true, api: false, bot: false });

expect('a shared component deploys web only',
  ['src/components/UserAvatar.tsx'], { web: true, api: false, bot: false });

expect('the API deploys api only',
  ['server/index.ts'], { web: false, api: true, bot: false });

expect('a bot command deploys bot only',
  ['telegram-bot/index.ts'], { web: false, api: false, bot: true });

expect('the bot analytics deploy bot only',
  ['telegram-bot/analytics.ts'], { web: false, api: false, bot: true });

expect('vite config deploys web only',
  ['vite.config.ts'], { web: true, api: false, bot: false });

expect('index.html deploys web only',
  ['index.html'], { web: true, api: false, bot: false });

expect('the app tsconfig deploys web only',
  ['tsconfig.app.json'], { web: true, api: false, bot: false });

expect('the server tsconfig deploys api only',
  ['tsconfig.json'], { web: false, api: true, bot: false });

// ── Changes that reach more than one service ───────────────
expect('a schema change deploys all three (every build runs prisma generate)',
  ['prisma/schema.prisma'], { web: true, api: true, bot: true });

expect('an SQL migration deploys all three',
  ['prisma/add-avatar-columns.sql'], { web: true, api: true, bot: true });

expect('a dependency bump deploys all three',
  ['package.json'], { web: true, api: true, bot: true });

expect('a lockfile change deploys all three',
  ['package-lock.json'], { web: true, api: true, bot: true });

// ── Mixed and unknown ──────────────────────────────────────
expect('a mixed push deploys exactly the services involved',
  ['src/App.tsx', 'server/auth.ts'], { web: true, api: true, bot: false });

expect('all three in one push',
  ['src/App.tsx', 'server/auth.ts', 'telegram-bot/index.ts'], { web: true, api: true, bot: true });

expect('an unrecognised file errs toward deploying everything',
  ['docker-compose.yml'], { web: true, api: true, bot: true });

// ── Files that cannot affect a deploy ──────────────────────
expect('a docs edit deploys nothing',
  ['README.md'], { web: false, api: false, bot: false });

expect('a workflow edit deploys nothing',
  ['.github/workflows/deploy.yml'], { web: false, api: false, bot: false });

expect('a test-script edit deploys nothing',
  ['scripts/privacy-smoke.mjs'], { web: false, api: false, bot: false });

expect('docs-only push mixed with a real change still deploys the real one',
  ['README.md', 'server/index.ts'], { web: false, api: true, bot: false });

// ── The empty case (a merge with no net change) ────────────
expect('an empty change list deploys nothing',
  [''], { web: false, api: false, bot: false });

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
