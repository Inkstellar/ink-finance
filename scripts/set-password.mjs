#!/usr/bin/env node
/**
 * Set (or create) a login for an ink-finance user.
 *
 *   npm run user:set-password                      # interactive, picks from a list
 *   npm run user:set-password -- --user K          # attach a login to user K
 *   npm run user:set-password --user K             # same — see the note below
 *   npm run user:set-password -- --email a@b.com --user K
 *   npm run user:set-password -- --email a@b.com --name "Preeti" --initials P
 *
 * NOTE ON `--`: npm treats unknown `--flags` as *its own* config and only
 * forwards the bare value, so `npm run user:set-password --user K` actually
 * runs `… K`. The script takes a non-email positional as the user selector
 * precisely so that this common form still works, but the canonical spelling
 * is `npm run user:set-password -- --user K`.
 *
 * Passwords are hashed with bcrypt (cost 12) and never printed or stored in
 * plain text. Prefer the interactive prompt: `--password` lands in your shell
 * history and in `ps` output.
 */
import 'dotenv/config';
import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Args ────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') out.email = argv[++i];
    else if (a === '--password') out.password = argv[++i];
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--initials') out.initials = argv[++i];
    else if (a === '--user') out.user = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('--')) out.positional.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`
  Set a password (and email) for an ink-finance login.

    npm run user:set-password                         interactive
    npm run user:set-password -- --user K             attach to an existing user
    npm run user:set-password --user K                works too (npm eats the flag)
    npm run user:set-password -- --email me@x.com --user K
    npm run user:set-password -- --email new@x.com --name "Preeti" --initials P

  Options
    --user      Existing user to attach the login to (id, name, or initials)
    --email     Login email
    --name      Display name   (only when creating a brand-new user)
    --initials  Avatar initials (only when creating a brand-new user)
    --password  Non-interactive password (insecure: shell history)
`);
  process.exit(0);
}

// npm forwards `--user K` as a bare "K", so a positional that is not an email
// is treated as the user selector rather than as an email address.
let emailArg;
let userSelector = args.user;
for (const p of args.positional) {
  if (LOOKS_LIKE_EMAIL.test(p) && !emailArg) emailArg = p;
  else if (!userSelector) userSelector = p;
}

// ── Prompt helpers ──────────────────────────────────────────
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
}

/** Reads a line without echoing it (falls back to plain read when piped). */
function askHidden(question) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(question);

    if (!stdin.isTTY) {
      const rl = readline.createInterface({ input: stdin, output: stdout });
      rl.once('line', (line) => {
        rl.close();
        resolve(line.trim());
      });
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();
    let input = '';

    const onData = (chunk) => {
      const s = chunk.toString('utf8');
      if (s === '\r' || s === '\n' || s === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        stdout.write('\n');
        resolve(input);
      } else if (s === '\u0003') {
        stdout.write('\n');
        process.exit(130); // Ctrl+C
      } else if (s === '\u007f' || s === '\b') {
        if (input.length) {
          input = input.slice(0, -1);
          stdout.write('\b \b');
        }
      } else {
        input += s;
        stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  // 1. Which user are we attaching this login to?
  let user = null;

  if (userSelector) {
    user = await prisma.finUser.findFirst({
      where: {
        OR: [
          { id: userSelector },
          { name: { equals: userSelector, mode: 'insensitive' } },
          { initials: { equals: userSelector.toUpperCase() } },
        ],
      },
    });
    if (!user) {
      console.error(`\n✗ No user matching "${userSelector}" — here is who exists:`);
      await listUsers();
      process.exit(1);
    }
    console.log(`\n  Using existing user: ${user.name} (${user.initials})`);
  } else if (emailArg) {
    user = await prisma.finUser.findUnique({ where: { email: emailArg.toLowerCase() } });
  }

  // No selector: show the list so the choice is obvious, and let them type one.
  if (!user && !emailArg) {
    await listUsers();
    const answer = await ask('Which user? (id, name, or initials — blank to create a new user): ');
    if (answer) {
      user = await prisma.finUser.findFirst({
        where: {
          OR: [
            { id: answer },
            { name: { equals: answer, mode: 'insensitive' } },
            { initials: { equals: answer.toUpperCase() } },
          ],
        },
      });
      if (!user) {
        console.error(`\n✗ No user matching "${answer}".`);
        process.exit(1);
      }
      console.log(`  Using existing user: ${user.name} (${user.initials})`);
    }
  }

  // 2. Email — offer the user's current one as the default.
  let email = args.email ?? emailArg ?? user?.email ?? '';
  if (!args.email && !emailArg) {
    const suggestion = user?.email ? `[${user.email}]` : '';
    const answer = await ask(`Email for login${suggestion}: `);
    email = answer || user?.email || '';
  }
  email = String(email).trim().toLowerCase();
  if (!LOOKS_LIKE_EMAIL.test(email)) {
    console.error(`\n✗ "${email}" does not look like an email address.`);
    process.exit(1);
  }

  // Guard the unique constraint with a readable message.
  const clash = await prisma.finUser.findUnique({ where: { email } });
  if (clash && clash.id !== user?.id) {
    console.error(`\n✗ ${email} is already the login for ${clash.name}.`);
    process.exit(1);
  }

  // 3. Name / initials when creating someone new.
  let name = args.name;
  let initials = args.initials;
  if (!user && !name) name = await ask('Display name: ');
  if (!user && !initials) {
    const fallback = (name || email).slice(0, 1).toUpperCase();
    initials = ((await ask(`Initials [${fallback}]: `)) || fallback).toUpperCase();
  }

  // 4. Password. Blank keeps the existing one when there is one.
  const hasPassword = Boolean(user?.passwordHash);
  let password = args.password;
  if (!password) {
    const hint = hasPassword ? ' (blank keeps the current password)' : '';
    password = await askHidden(`Password${hint}: `);
    if (password) {
      const confirm = await askHidden('Confirm password: ');
      if (password !== confirm) {
        console.error('\n✗ Passwords do not match.');
        process.exit(1);
      }
    } else if (!hasPassword) {
      console.error('\n✗ A password is required for a new login.');
      process.exit(1);
    }
  }
  if (password && password.length < 8) {
    console.error('\n✗ Password must be at least 8 characters.');
    process.exit(1);
  }

  // 5. Save.
  if (user) {
    await prisma.finUser.update({
      where: { id: user.id },
      data: {
        email,
        ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}),
        ...(name ? { name } : {}),
        ...(initials ? { initials } : {}),
      },
    });
    console.log(`\n✅ ${user.name} can sign in as ${email}${password ? '' : ' (password unchanged)'}`);
  } else {
    const created = await prisma.finUser.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 12),
        name: name || email.split('@')[0],
        initials: (initials || (name || email).slice(0, 2)).slice(0, 2),
      },
    });
    console.log(`\n✅ Created user ${created.name} (${created.initials}) — sign in as ${email}`);
  }

  console.log('   Sign out and back in if a session is already open.\n');
  await prisma.$disconnect();
}

async function listUsers() {
  const users = await prisma.finUser.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, initials: true, email: true, passwordHash: true },
  });
  if (!users.length) {
    console.log('\n  (no users yet — this will create one)\n');
    return;
  }
  console.log('\n  Existing users:');
  for (const u of users) {
    const login = u.email
      ? `<${u.email}>${u.passwordHash ? '' : '  ⚠ no password set'}`
      : 'no login yet';
    console.log(`    ${u.initials.padEnd(3)} ${u.name.padEnd(16)} ${login}`);
  }
  console.log('');
}

main().catch(async (err) => {
  console.error('\n✗ Failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
