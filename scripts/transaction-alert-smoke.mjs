#!/usr/bin/env node
/**
 * End-to-end check that adding a transaction alerts the *other* user.
 *
 *   npm run test:alerts
 *
 * Starts a stub Telegram Bot API and a dedicated API server pointed at it, then
 * creates transactions the two ways they really get created — a signed-in
 * browser session, and the bot's service token — and asserts who was messaged.
 *
 * Nothing leaves the machine: TELEGRAM_API_BASE redirects every send to the
 * stub, so a real chat id in the database cannot be messaged even by accident.
 * The database is the real one, so this writes throwaway users/accounts and
 * removes them in a `finally`.
 *
 * Targeted assertions, not counts: the database holds real users with real
 * telegram ids, and they are recipients too. Counting would make the test
 * depend on who else happens to be registered.
 */
import 'dotenv/config';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const API_PORT = 3457;

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

// ── Stub Telegram ───────────────────────────────────────────
const sent = [];
const stub = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.method === 'POST' && /\/sendMessage$/.test(req.url)) {
      try {
        sent.push({ path: req.url, ...JSON.parse(body) });
      } catch {
        sent.push({ path: req.url, unparseable: body });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true,"result":{"message_id":1}}');
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"ok":false}');
    }
  });
});

/** Messages to one chat id. */
const to = (chatId) => sent.filter((m) => String(m.chat_id) === String(chatId));

/** Poll until `predicate` holds — the API sends alerts after responding. */
async function waitFor(predicate, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log(`       (timed out waiting for ${label})`);
  return false;
}

/** Very small cookie jar: Auth.js needs the CSRF cookie echoed back. */
class Jar {
  cookies = new Map();
  absorb(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

const BASE = `http://localhost:${API_PORT}`;
const mark = `ZZ-ALERT-${Date.now()}`;

async function main() {
  // ── Bring up the stub and the API ───────────────────────
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const stubPort = stub.address().port;
  console.log(`\n  telegram stub: http://127.0.0.1:${stubPort}`);
  console.log(`  api: ${BASE}\n`);

  const api = spawn('npx', ['tsx', 'server/index.ts'], {
    env: {
      ...process.env,
      API_PORT: String(API_PORT),
      BOT_TOKEN: 'TEST:STUB',
      TELEGRAM_API_BASE: `http://127.0.0.1:${stubPort}`,
      WEB_URL: 'https://ink-finance-web.onrender.com',
      TZ: 'Asia/Kolkata',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const apiLog = [];
  api.stdout.on('data', (d) => apiLog.push(String(d)));
  api.stderr.on('data', (d) => apiLog.push(String(d)));

  const ready = await waitFor(
    () => apiLog.some((l) => l.includes('API server running')),
    'the API to start',
    20000,
  );
  check('the API started', ready);
  if (!ready) {
    console.log(apiLog.join(''));
    throw new Error('API did not start');
  }

  // ── Throwaway data ──────────────────────────────────────
  // Telegram ids in a range no real account will hold.
  const tgA = `8${Date.now()}`;
  const tgB = `9${Date.now()}`;

  const actor = await prisma.finUser.create({
    data: {
      email: `${mark.toLowerCase()}-a@local.test`,
      passwordHash: await bcrypt.hash(randomBytes(18).toString('base64url'), 12),
      name: 'Alert Actor',
      initials: 'AA',
      telegramId: tgA,
    },
  });
  const password = randomBytes(18).toString('base64url');
  await prisma.finUser.update({
    where: { id: actor.id },
    data: { passwordHash: await bcrypt.hash(password, 12) },
  });
  const other = await prisma.finUser.create({
    data: {
      name: 'Alert Other',
      initials: 'AO',
      telegramId: tgB,
    },
  });
  const account = await prisma.finAccount.create({
    data: { name: mark, type: 'CHECKING', balance: 5000 },
  });

  const txIds = [];

  try {
    // ── 1. A browser session creates a transaction ────────
    const jar = new Jar();
    {
      const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
      jar.absorb(csrfRes);
      const { csrfToken } = await csrfRes.json();
      const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Auth-Return-Redirect': '1',
          cookie: jar.header(),
        },
        body: new URLSearchParams({
          email: actor.email,
          password,
          csrfToken,
          callbackUrl: BASE,
          redirect: 'false',
        }),
      });
      jar.absorb(res);
      const body = await res.json().catch(() => ({}));
      check('signed in as the actor', !String(body.url ?? '').includes('error='), body.url ?? '');
    }

    sent.length = 0;
    {
      const res = await fetch(`${BASE}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: jar.header() },
        body: JSON.stringify({
          amount: 1500,
          type: 'EXPENSE',
          date: '2026-09-20',
          description: 'bus ticket',
          accountId: account.id,
          userId: actor.id,
        }),
      });
      check('the transaction was created', res.status === 200, `got ${res.status}`);
      txIds.push((await res.json()).id);
    }

    await waitFor(() => to(tgB).length > 0, 'the alert to the other user');
    const alerts = to(tgB);
    check('the other user is alerted', alerts.length === 1, `${alerts.length} message(s)`);
    check('the actor is not alerted about their own entry', to(tgA).length === 0, `${to(tgA).length} message(s)`);

    if (alerts.length) {
      const msg = alerts[0];
      check('it is addressed to the other user\'s chat', String(msg.chat_id) === tgB);
      check('it is HTML', msg.parse_mode === 'HTML');
      check('it names the amount', msg.text.includes('-₹1,500.00'), msg.text.split('\n')[2]);
      check('it names the description', msg.text.includes('bus ticket'));
      check('it names the account', msg.text.includes(mark));
      check('it names the date', msg.text.includes('20 Sep 2026'));
      check('it says who added it', msg.text.includes('Added by <b>Alert Actor</b>'));
      check('it shows the new balance', msg.text.includes('₹3,500.00'), '5000 - 1500');
      check('it links back into the app', msg.reply_markup?.inline_keyboard?.[0]?.[0]?.url ===
        'https://ink-finance-web.onrender.com/transactions');
    }

    // ── 2. The bot's service token creates one ────────────
    // The bot names the actor in headers; here the *other* user is acting.
    sent.length = 0;
    {
      const res = await fetch(`${BASE}/api/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Token': process.env.SERVICE_TOKEN,
          'X-Actor-Telegram-Id': tgB,
          'X-Actor-User-Id': other.id,
        },
        body: JSON.stringify({
          amount: 250,
          type: 'EXPENSE',
          date: '2026-09-21',
          description: 'chai',
          accountId: account.id,
          userId: other.id,
        }),
      });
      check('a service-token transaction is created', res.status === 200, `got ${res.status}`);
      txIds.push((await res.json()).id);
    }

    await waitFor(() => to(tgA).length > 0, 'the alert to the first user');
    check('the acting user is not alerted', to(tgB).length === 0, `${to(tgB).length} message(s)`);
    check('the other user is', to(tgA).length === 1, `${to(tgA).length} message(s)`);
    if (to(tgA).length) {
      check('the second alert names its own actor', to(tgA)[0].text.includes('Added by <b>Alert Other</b>'));
    }

    // ── 3. A browser cannot silence someone else's alert ──
    // X-Actor-* is only honoured from a service-token caller. A session names
    // its own user, so these headers must be ignored and the actor's own id
    // used instead — the second user still gets told.
    sent.length = 0;
    {
      const res = await fetch(`${BASE}/api/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: jar.header(),
          // Impersonation attempt: claim the other user acted.
          'X-Actor-Telegram-Id': tgB,
          'X-Actor-User-Id': other.id,
        },
        body: JSON.stringify({
          amount: 99,
          type: 'EXPENSE',
          date: '2026-09-21',
          description: 'spoof attempt',
          accountId: account.id,
        }),
      });
      check('the transaction is created', res.status === 200, `got ${res.status}`);
      txIds.push((await res.json()).id);
    }

    await waitFor(() => to(tgB).length > 0, 'the alert to the other user');
    check('a session cannot spoof the actor to silence an alert', to(tgB).length === 1,
      `${to(tgB).length} message(s) to the other user`);
    check('and the real actor is still left out', to(tgA).length === 0, `${to(tgA).length} message(s)`);
  } finally {
    api.kill('SIGTERM');
    stub.close();
    for (const id of txIds) {
      await prisma.finTransaction.delete({ where: { id } }).catch(() => {});
    }
    await prisma.finAccount.delete({ where: { id: account.id } }).catch(() => {});
    await prisma.finUser.delete({ where: { id: actor.id } }).catch(() => {});
    await prisma.finUser.delete({ where: { id: other.id } }).catch(() => {});
    const left = await prisma.finUser.count({ where: { name: { startsWith: 'Alert ' } } });
    console.log(`\n  cleaned up — leftover test users: ${left}\n`);
    await prisma.$disconnect();
  }

  console.log(`  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('\n  fatal:', err);
  await prisma.$disconnect();
  process.exit(1);
});
