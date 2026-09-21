#!/usr/bin/env node
/**
 * Set (or create) a login for an ink-finance user.
 *
 *   npm run user:set-password                       # interactive
 *   npm run user:set-password -- --email a@b.com
 *   npm run user:set-password -- --email a@b.com --user K   # attach login to an existing user
 *   npm run user:set-password -- --email a@b.com --name "Kousi" --initials K
 *
 * Passwords are hashed with bcrypt (cost 12) and never printed or stored in
 * plain text. Prefer the interactive prompt: `--password` lands in your shell
 * history and in `ps` output.
 *
 * A user with no `passwordHash` simply cannot sign in, so attaching a login to
 * a pre-existing user (the seeded K / P rows) is just a matter of setting one.
 */
import 'dotenv/config';
import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Args ────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') out.email = argv[++i];
    else if (a === '--password') out.password = argv[++i];
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--initials') out.initials = argv[++i];
    else if (a === '--user') out.user = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('--')) out._positional = a; // allow `-- a@b.com`
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`
  Set a password for an ink-finance login.

    npm run user:set-password
    npm run user:set-password -- --email kousi@example.com
    npm run user:set-password -- --email kousi@example.com --user K
    npm run user:set-password -- --email new@example.com --name "Preeti" --initials P

  Options
    --email     Login email (prompted if omitted)
    --user      Attach the login to an existing user (id, name, or initials)
    --name      Display name (only when creating a brand-new user)
    --initials  Avatar initials (only when creating a brand-new user)
    --password  Non-interactive password (insecure: shell history)
`);
  process.exit(0);
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

function askHidden(question) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(question);

    if (!stdin.isTTY) {
      // Piped input (e.g. `echo pw | npm run …`) — just read a line.
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
  let email = args.email ?? args._positional;
  if (!email) email = await ask('Email: ');
  email = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`✗ "${email}" does not look like an email address.`);
    process.exit(1);
  }

  // Which user are we attaching this login to?
  let user = null;
  if (args.user) {
    user = await prisma.finUser.findFirst({
      where: {
        OR: [{ id: args.user }, { name: args.user }, { initials: args.user.toUpperCase() }],
      },
    });
    if (!user) {
      console.error(`✗ No user matching "${args.user}".`);
      process.exit(1);
    }
    console.log(`  Attaching login to existing user: ${user.name} (${user.initials})`);
  } else {
    user = await prisma.finUser.findUnique({ where: { email } });
    if (user) {
      console.log(`  Updating login for existing user: ${user.name}`);
    } else {
      const users = await prisma.finUser.findMany({ select: { id: true, name: true, initials: true, email: true } });
      if (users.length) {
        console.log('\n  Existing users in this database:');
        for (const u of users) {
          console.log(`    ${u.initials.padEnd(3)} ${u.name}${u.email ? `  <${u.email}>` : '  (no login yet)'}`);
        }
        console.log('');
      }
    }
  }

  // Name / initials when creating a brand-new user.
  let name = args.name;
  let initials = args.initials;
  if (!user && !name) name = await ask('Display name: ');
  if (!user && !initials) initials = (await ask(`Initials [${(name ?? 'U').slice(0, 1).toUpperCase()}]: `)).toUpperCase();

  // Password.
  let password = args.password;
  if (!password) {
    password = await askHidden('Password: ');
    const confirm = await askHidden('Confirm password: ');
    if (password !== confirm) {
      console.error('\n✗ Passwords do not match.');
      process.exit(1);
    }
  }
  if (!password || password.length < 8) {
    console.error('\n✗ Password must be at least 8 characters.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  if (user) {
    await prisma.finUser.update({
      where: { id: user.id },
      data: { email, passwordHash, ...(name ? { name } : {}), ...(initials ? { initials } : {}) },
    });
    console.log(`\n✅ ${user.name} can now sign in as ${email}`);
  } else {
    const created = await prisma.finUser.create({
      data: {
        email,
        passwordHash,
        name: name || email.split('@')[0],
        initials: (initials || (name || email).slice(0, 1).toUpperCase()).slice(0, 2),
      },
    });
    console.log(`\n✅ Created user ${created.name} (${created.initials}) — sign in as ${email}`);
  }

  console.log('   Sign out and back in if a session is already open.\n');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('\n✗ Failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
