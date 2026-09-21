#!/usr/bin/env node
/**
 * Regression test for the transaction endpoints, focused on account balances.
 *
 *   npm run test:tx                     # against http://localhost:3456
 *   API_BASE=https://… npm run test:tx
 *
 * Uses two throwaway accounts so the balance effects are unambiguous, and
 * cleans up through Prisma (the API has no hard delete, and deleting a
 * transaction does not reverse its balance effect).
 *
 * Authenticates with SERVICE_TOKEN — the bot's credential.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = process.env.API_BASE || 'http://localhost:3456';
const TOKEN = process.env.SERVICE_TOKEN;
const headers = { 'Content-Type': 'application/json', 'X-Service-Token': TOKEN };

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

const call = async (path, method = 'GET', body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

const balanceOf = async (id) => (await call('/api/accounts')).data.find((a) => a.id === id)?.balance;

async function main() {
  if (!TOKEN) {
    console.error('\n  ✗ SERVICE_TOKEN is not set — cannot authenticate.\n');
    process.exit(1);
  }

  const mark = `ZZ-TX-${Date.now()}`;
  const createdIds = [];

  // Throwaway accounts, starting from a known balance.
  const a = (await call('/api/accounts', 'POST', { name: `${mark}-A`, type: 'CHECKING', balance: 1000 })).data;
  const b = (await call('/api/accounts', 'POST', { name: `${mark}-B`, type: 'SAVINGS', balance: 500 })).data;
  console.log(`\n  target: ${BASE}`);
  console.log(`  temp accounts: A=${a.id.slice(-6)} (₹1000)  B=${b.id.slice(-6)} (₹500)\n`);

  const add = async (body) => {
    const r = await call('/api/transactions', 'POST', body);
    if (r.data?.id) createdIds.push(r.data.id);
    return r;
  };

  try {
    // ── Expense and income ────────────────────────────────
    await add({ amount: 200, type: 'EXPENSE', date: '2026-09-01', description: `${mark} expense`, accountId: a.id });
    check('expense debits the account', (await balanceOf(a.id)) === 800, `balance ${await balanceOf(a.id)}`);

    await add({ amount: 500, type: 'INCOME', date: '2026-09-02', description: `${mark} income`, accountId: a.id });
    check('income credits the account', (await balanceOf(a.id)) === 1300, `balance ${await balanceOf(a.id)}`);

    await add({ amount: 300, type: 'INVESTMENT_BUY', date: '2026-09-03', description: `${mark} buy`, accountId: a.id });
    check('investment buy debits the account', (await balanceOf(a.id)) === 1000, `balance ${await balanceOf(a.id)}`);

    await add({ amount: 150, type: 'INVESTMENT_SELL', date: '2026-09-04', description: `${mark} sell`, accountId: a.id });
    check('investment sell credits the account', (await balanceOf(a.id)) === 1150, `balance ${await balanceOf(a.id)}`);

    // ── Transfer: both sides must move ────────────────────
    const before = { a: await balanceOf(a.id), b: await balanceOf(b.id) };
    await add({
      amount: 250, type: 'TRANSFER', date: '2026-09-05', description: `${mark} transfer`,
      accountId: a.id, toAccountId: b.id,
    });
    const after = { a: await balanceOf(a.id), b: await balanceOf(b.id) };
    check('transfer debits the source', after.a === before.a - 250, `${before.a} → ${after.a}`);
    check('transfer credits the destination', after.b === before.b + 250, `${before.b} → ${after.b}`);

    // A transfer with no destination must be refused rather than silently
    // moving nothing.
    const noDest = await call('/api/transactions', 'POST', {
      amount: 50, type: 'TRANSFER', date: '2026-09-05', description: `${mark} bad transfer`, accountId: a.id,
    });
    check('transfer without a destination is rejected', noDest.status === 400, `got ${noDest.status}`);

    // ── Filters ───────────────────────────────────────────
    const all = await call(`/api/transactions?limit=200`);
    const mine = all.data.filter((t) => t.description?.startsWith(mark));
    // Five rows: the rejected transfer correctly left none behind.
    check('all created rows are queryable', mine.length === 5, `found ${mine.length}`);

    const ranged = await call('/api/transactions?from=2026-09-03&to=2026-09-04&limit=200');
    const rangedMine = ranged.data.filter((t) => t.description?.startsWith(mark));
    check('from/to narrows the range', rangedMine.length === 2, `found ${rangedMine.length}`);

    const single = await call('/api/transactions?from=2026-09-05&to=2026-09-05&limit=200');
    check(
      'a single-day range is inclusive at both ends',
      single.data.filter((t) => t.description?.startsWith(mark)).length === 1,
      `found ${single.data.filter((t) => t.description?.startsWith(mark)).length}`,
    );

    const typed = await call('/api/transactions?type=TRANSFER&limit=200');
    check('type filter works', typed.data.every((t) => t.type === 'TRANSFER'));

    const byUser = await call('/api/transactions?userId=does-not-exist&limit=200');
    check('userId filter returns nothing for an unknown user', byUser.data.length === 0);
  } finally {
    // Direct cleanup: the API archives accounts and leaves balances alone on
    // transaction delete, so neither is right for a throwaway fixture.
    await prisma.finTransaction.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.finAccount.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    await prisma.$disconnect();
  }

  const leftovers = await prisma.finAccount.count({ where: { name: { startsWith: mark } } }).catch(() => 0);
  check('cleanup: temp accounts removed', leftovers === 0);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (err) => {
  console.error('transaction smoke test failed to run:', err);
  await prisma.$disconnect();
  process.exit(1);
});
