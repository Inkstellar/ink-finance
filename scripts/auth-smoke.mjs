#!/usr/bin/env node
/**
 * End-to-end check of the Auth.js integration against a running API.
 *
 *   npm run test:auth                        # against http://localhost:3456
 *   API_BASE=https://ink-finance-api.onrender.com npm run test:auth
 *
 * Creates a throwaway user with a randomly generated password, exercises the
 * real HTTP flow (CSRF → credentials callback → session → protected routes →
 * sign-out), then deletes the user. Safe to run repeatedly; it never touches
 * existing users or transactions.
 *
 * Pointing API_BASE at the deployed API writes a user to the production
 * database, so prefer the local API.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = process.env.API_BASE || 'http://localhost:3456';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

/** Very small cookie jar: Auth.js needs the CSRF cookie echoed back. */
class Jar {
  cookies = new Map();
  absorb(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  names() {
    return [...this.cookies.keys()];
  }
}

/**
 * Auth.js answers 302 + Set-Cookie by default, and fetch swallows the cookie
 * on the redirect hop. `X-Auth-Return-Redirect: 1` makes it reply
 * `200 {"url": …}` with the cookie on this response — what the SPA does too.
 */
const callbackHeaders = (jar) => ({
  'Content-Type': 'application/x-www-form-urlencoded',
  'X-Auth-Return-Redirect': '1',
  cookie: jar.header(),
});

async function csrf(jar) {
  const res = await fetch(`${BASE}/api/auth/csrf`);
  jar.absorb(res);
  return (await res.json()).csrfToken;
}

async function main() {
  const email = `smoke-${Date.now()}@local.test`;
  const password = randomBytes(18).toString('base64url');
  const wrongPassword = randomBytes(18).toString('base64url');

  const user = await prisma.finUser.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      name: 'Smoke Test',
      initials: 'ST',
    },
  });
  console.log(`\n  target: ${BASE}`);
  console.log(`  temp user: ${email} (deleted at the end)\n`);

  try {
    // ── Public routes stay public ───────────────────────────
    check('health is public', (await fetch(`${BASE}/api/health`)).status === 200);
    check('protected route rejects anonymous', (await fetch(`${BASE}/api/transactions`)).status === 401);

    // ── Reject a bad password ───────────────────────────────
    {
      const jar = new Jar();
      const csrfToken = await csrf(jar);
      const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
        method: 'POST',
        headers: callbackHeaders(jar),
        body: new URLSearchParams({ email, password: wrongPassword, csrfToken, callbackUrl: BASE, redirect: 'false' }),
      });
      jar.absorb(res);
      const body = await res.json().catch(() => ({}));
      check('wrong password is rejected', String(body.url ?? '').includes('error='));
      check('no session after failed login', (await fetch(`${BASE}/api/transactions`, { headers: { cookie: jar.header() } })).status === 401);
    }

    // ── Accept the right password ───────────────────────────
    {
      const jar = new Jar();
      const csrfToken = await csrf(jar);
      const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
        method: 'POST',
        headers: callbackHeaders(jar),
        body: new URLSearchParams({ email, password, csrfToken, callbackUrl: BASE, redirect: 'false' }),
      });
      jar.absorb(res);
      const body = await res.json().catch(() => ({}));
      check('correct password accepted', !String(body.url ?? '').includes('error='));
      check('session cookie issued', jar.names().some((n) => n.includes('session-token')));

      const session = await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie: jar.header() } })).json();
      check('session exposes the user', session?.user?.email === email);
      check('session carries initials', session?.user?.initials === 'ST');
      check('protected route allows the session', (await fetch(`${BASE}/api/transactions`, { headers: { cookie: jar.header() } })).status === 200);
      check('dashboard allows the session', (await fetch(`${BASE}/api/dashboard`, { headers: { cookie: jar.header() } })).status === 200);

      // ── Sign out ──────────────────────────────────────────
      const signout = await fetch(`${BASE}/api/auth/signout`, {
        method: 'POST',
        headers: callbackHeaders(jar),
        body: new URLSearchParams({ csrfToken, callbackUrl: BASE, redirect: 'false' }),
      });
      jar.absorb(signout);
      check('sign-out clears the session cookie', !jar.names().some((n) => n.includes('session-token')));
      check('no session cookie means 401', (await fetch(`${BASE}/api/transactions`, { headers: { cookie: jar.header() } })).status === 401);
    }
  } finally {
    await prisma.finUser.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (err) => {
  console.error('auth smoke test failed to run:', err);
  await prisma.$disconnect();
  process.exit(1);
});
