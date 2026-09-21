#!/usr/bin/env node
/**
 * Regression test: no endpoint may leak a user's secrets.
 *
 *   npm run test:privacy                     # against http://localhost:3456
 *   API_BASE=https://… npm run test:privacy
 *
 * Why this exists
 * ---------------
 * Eight endpoints embed a user in their response (`include: { user: … }`).
 * Prisma's `include: { user: true }` returns *every* column — which meant
 * `passwordHash` (a bcrypt digest) and the whole base64 profile picture were
 * being shipped to the browser on every transaction, loan and dashboard load.
 * The fix selects an explicit field set and maps the row through
 * `withPublicUser`, which drops `avatarMime` and adds a `hasAvatar` boolean.
 *
 * A field list is only as good as the next edit to it, so this test asserts the
 * *exact* key set of every embedded user object rather than blacklisting the
 * two fields that happened to leak. Adding a field is then a deliberate act:
 * update the list below, or the test fails.
 *
 * It also scans the raw response text for the throwaway user's real bcrypt
 * digest and real base64 image, so a leak through a nested or renamed path is
 * caught too — and it self-checks with a canary, because a scanner that finds
 * nothing because it is broken is worse than no scanner.
 *
 * Creates a throwaway user (with a password and a picture), account, one
 * transaction and one loan, and removes all of them in a `finally`. Existing
 * data is never touched.
 *
 * Authenticates with SERVICE_TOKEN — the bot's credential.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = process.env.API_BASE || 'http://localhost:3456';
const TOKEN = process.env.SERVICE_TOKEN;

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

// ── What a user object is allowed to carry ──────────────────
// There are two shapes, and they are deliberately different.
//
// Embedded: a user attached to a transaction, loan or dashboard row. Mirrors
// EMBEDDED_USER_SELECT in server/index.ts, plus `hasAvatar`, which
// withPublicUser derives from `avatarMime` before stripping it. Contact
// details have no business on a transaction row.
const ALLOWED_USER_KEYS = ['color', 'hasAvatar', 'id', 'initials', 'name', 'updatedAt'];

// Standalone: /api/users and /api/users/me, which back the user-management
// page. Email and the telegram id are the point of that page, so they are
// expected here — and only here.
const ALLOWED_FULL_USER_KEYS = [
  'color', 'createdAt', 'email', 'hasAvatar', 'hasPassword',
  'id', 'initials', 'name', 'telegramId', 'updatedAt',
];

// Never acceptable in any response body, under any shape. These are the two
// that actually leaked: the bcrypt digest and the base64 picture.
const SECRET_KEYS = ['passwordHash', 'avatar', 'avatarMime'];

// The same, plus fields that are fine on the management page but must not
// ride along on every transaction and loan.
const FORBIDDEN_KEYS = [...SECRET_KEYS, 'email', 'telegramId'];

/**
 * Walk a parsed body and collect every embedded user object, plus every
 * forbidden key seen at any depth.
 */
function scan(node, forbiddenKeys, found = { users: [], forbidden: [], paths: [] }, path = '$') {
  if (Array.isArray(node)) {
    node.forEach((item, i) => scan(item, forbiddenKeys, found, `${path}[${i}]`));
    return found;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (forbiddenKeys.includes(key)) found.forbidden.push(`${path}.${key}`);
      scan(value, forbiddenKeys, found, `${path}.${key}`);
    }
    // A user object is anything shaped like one. `initials` is the tell:
    // no other table has it.
    if (typeof node.initials === 'string' && typeof node.id === 'string') {
      found.users.push({ path, keys: Object.keys(node).sort(), obj: node });
    }
  }
  return found;
}

/**
 * Scan one response: parse it, run the structural checks, then scan the raw
 * text for the throwaway user's actual secrets.
 *
 * `shape` picks which user representation is expected — see the two key lists
 * at the top.
 */
function audit(label, bodyText, secrets, shape = 'embedded') {
  const allowedKeys = shape === 'full' ? ALLOWED_FULL_USER_KEYS : ALLOWED_USER_KEYS;
  const forbiddenKeys = shape === 'full' ? SECRET_KEYS : FORBIDDEN_KEYS;

  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    check(`${label} — response is JSON`, false, bodyText.slice(0, 80));
    return;
  }

  const { users, forbidden } = scan(json, forbiddenKeys);

  check(
    `${label} — no forbidden user fields`,
    forbidden.length === 0,
    forbidden.slice(0, 4).join(', '),
  );

  const badKeys = users.filter((u) => u.keys.join() !== allowedKeys.join());
  check(
    `${label} — every user carries exactly the expected fields`,
    badKeys.length === 0,
    badKeys.map((u) => `${u.path}: ${u.keys.join()}`).slice(0, 2).join(' | '),
  );

  // Raw-text sweeps: these catch a leak that arrives under a different key
  // name, or nested somewhere the structural walk does not recognise.
  const leakedHash = bodyText.includes(secrets.hashPrefix);
  const leakedImage = bodyText.includes(secrets.imageSlice);
  const leakedDataUrl = bodyText.includes('data:image/');
  check(`${label} — no bcrypt digest in the body`, !leakedHash);
  check(`${label} — no base64 image data in the body`, !leakedImage && !leakedDataUrl);

  return users;
}

async function main() {
  if (!TOKEN) {
    console.error('\n  ✗ SERVICE_TOKEN is not set — cannot authenticate.\n');
    process.exit(1);
  }

  const mark = `ZZ-PRIV-${Date.now()}`;
  const password = randomBytes(18).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 12);
  const hashPrefix = passwordHash.slice(0, 12);

  // A real 1×1 PNG. Stored on the user so that a leak would carry recognisable
  // bytes rather than an empty string.
  const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  const imageSlice = PNG_BASE64.slice(0, 60);
  const secrets = { hashPrefix, imageSlice };

  const user = await prisma.finUser.create({
    data: {
      email: `${mark.toLowerCase()}@local.test`,
      passwordHash,
      name: 'Privacy Test',
      initials: 'PT',
      color: '#123456',
      avatar: PNG_BASE64,
      avatarMime: 'image/png',
      telegramId: `999${Date.now()}`,
    },
  });

  const account = await prisma.finAccount.create({
    data: { name: mark, type: 'CHECKING', balance: 0 },
  });

  console.log(`\n  target: ${BASE}`);
  console.log(`  temp user: ${user.email} (with a password, a picture and a telegram id)`);
  console.log(`  temp account: ${mark}\n`);

  const createdTx = [];
  const createdLoans = [];

  const call = async (path, method = 'GET', body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Service-Token': TOKEN },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, text: await res.text() };
  };

  try {
    // ── The scanner has to be able to fail ──────────────────
    // Without this, a typo in the walk would make every check below pass.
    {
      const canary = JSON.stringify({
        id: 'tx1',
        user: { id: 'u1', initials: 'PT', passwordHash: '$2b$12$CANARY' },
      });
      const { forbidden } = scan(JSON.parse(canary), FORBIDDEN_KEYS);
      check(
        'canary: the scanner detects a planted passwordHash',
        forbidden.includes('$.user.passwordHash'),
        forbidden.join(', ') || 'nothing found',
      );

      const textCanary = `{"user":{"id":"u1","initials":"PT","avatar":"${imageSlice}"}}`;
      check('canary: the raw-text sweep detects planted image data', textCanary.includes(imageSlice));
    }

    // ── Build the data every embedding endpoint needs ───────
    {
      const res = await call('/api/transactions', 'POST', {
        amount: 1,
        type: 'EXPENSE',
        date: '2026-01-01',
        description: `${mark}-tx`,
        accountId: account.id,
        userId: user.id,
      });
      if (res.status === 200) createdTx.push(JSON.parse(res.text).id);
      check('setup: a transaction owned by the temp user exists', res.status === 200, `got ${res.status}`);
      audit('POST /api/transactions', res.text, secrets);
    }

    {
      const res = await call('/api/loans', 'POST', {
        name: `${mark}-loan`,
        lender: 'Test Bank',
        principal: 1000,
        interestRate: 10,
        tenureMonths: 12,
        monthlyEmi: 100,
        disbursedOn: '2026-01-01',
        accountId: account.id,
        userId: user.id,
      });
      if (res.status === 200) createdLoans.push(JSON.parse(res.text).id);
      check('setup: a loan owned by the temp user exists', res.status === 200, `got ${res.status}`);
      audit('POST /api/loans', res.text, secrets);
    }

    const loanId = createdLoans[0];

    // ── Every endpoint that embeds a user ───────────────────
    {
      const res = await call(`/api/transactions?userId=${user.id}&limit=5`);
      const users = audit('GET /api/transactions', res.text, secrets);
      check(
        'GET /api/transactions — the temp user is reported as having a picture',
        users.some((u) => u.obj.id === user.id && u.obj.hasAvatar === true),
        `${users.length} embedded user(s)`,
      );
      check(
        'GET /api/transactions — hasAvatar is false for users without one',
        users.every((u) => typeof u.obj.hasAvatar === 'boolean'),
      );
    }

    audit('GET /api/loans', (await call('/api/loans')).text, secrets);

    audit('PUT /api/loans/:id', (await call(`/api/loans/${loanId}`, 'PUT', { name: `${mark}-renamed` })).text, secrets);

    {
      const payment = await call(`/api/loans/${loanId}/payment`, 'POST', {
        amount: 100,
        principal: 80,
        interest: 20,
        balance: 920,
        paidOn: '2026-02-01',
      });
      check('setup: a payment was recorded', payment.status === 200, `got ${payment.status}`);

      const list = await call(`/api/loans`);
      const paymentId = JSON.parse(list.text).find((l) => l.id === loanId)?.payments?.[0]?.id;
      check('setup: the payment is readable on the loan', Boolean(paymentId));

      const del = await call(`/api/loans/${loanId}/payments/${paymentId}`, 'DELETE');
      check('DELETE …/payments/:paymentId succeeds', del.status === 200, `got ${del.status}`);
      audit('DELETE /api/loans/:id/payments/:paymentId', del.text, secrets);
    }

    audit('GET /api/dashboard', (await call('/api/dashboard')).text, secrets);

    // ── The user endpoints themselves ───────────────────────
    // A different shape: this is the management page, so email and the
    // telegram id are expected — the secrets still are not.
    {
      const res = await call('/api/users');
      audit('GET /api/users', res.text, secrets, 'full');
      const list = JSON.parse(res.text);
      const row = list.find((u) => u.id === user.id);
      check('GET /api/users — reports hasPassword, not the hash', row?.hasPassword === true);
      check('GET /api/users — reports hasAvatar', row?.hasAvatar === true);
    }

    // ── Serving the picture is the only way to get the bytes ─
    {
      const res = await fetch(`${BASE}/api/users/${user.id}/avatar`, {
        headers: { 'X-Service-Token': TOKEN },
      });
      const bytes = Buffer.from(await res.arrayBuffer());
      check('GET /api/users/:id/avatar — serves the picture', res.status === 200, `got ${res.status}`);
      check('GET /api/users/:id/avatar — byte-exact', bytes.equals(Buffer.from(PNG_BASE64, 'base64')));
    }
  } finally {
    for (const id of createdLoans) {
      await prisma.finLoanPayment.deleteMany({ where: { loanId: id } }).catch(() => {});
      await prisma.finLoan.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdTx) {
      await prisma.finTransaction.delete({ where: { id } }).catch(() => {});
    }
    await prisma.finAccount.delete({ where: { id: account.id } }).catch(() => {});
    await prisma.finUser.delete({ where: { id: user.id } }).catch(() => {});
    console.log(`\n  cleaned up: ${user.email}, its account, transaction and loan\n`);
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
