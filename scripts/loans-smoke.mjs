#!/usr/bin/env node
/**
 * Regression test for the loan endpoints.
 *
 *   npm run test:loans                        # against http://localhost:3456
 *   API_BASE=https://… npm run test:loans
 *
 * Creates a throwaway loan, edits it, records and removes payments, deletes it,
 * and checks the outstanding balance is restored sensibly at each step. Existing
 * loans are only counted, never modified.
 *
 * Authenticates with SERVICE_TOKEN (the bot's credential) so it needs no
 * session — set it in .env, or pass one for a deployed API.
 */
import 'dotenv/config';

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

/** There is no GET /api/loans/:id — read the list and pick the loan out. */
const getLoan = async (id) => ((await call('/api/loans')).data || []).find((l) => l.id === id);

async function main() {
  if (!TOKEN) {
    console.error('\n  ✗ SERVICE_TOKEN is not set — cannot authenticate.\n');
    process.exit(1);
  }

  const baseline = (await call('/api/loans')).data;
  console.log(`\n  target: ${BASE}`);
  console.log(`  baseline: ${baseline.length} existing loan(s)\n`);

  let loanId;

  try {
    // ── Create ────────────────────────────────────────────
    const created = await call('/api/loans', 'POST', {
      name: 'ZZ Regression Loan',
      lender: 'Test Bank',
      principal: 100000,
      interestRate: 9,
      tenureMonths: 60,
      monthlyEmi: 2076,
      disbursedOn: '2026-01-15',
    });
    loanId = created.data?.id;
    check('create loan', created.status === 200 && Boolean(loanId));
    check('outstanding starts at the principal', created.data?.remainingPrincipal === 100000, `got ${created.data?.remainingPrincipal}`);

    // ── Full edit ─────────────────────────────────────────
    const edited = await call(`/api/loans/${loanId}`, 'PUT', {
      name: 'ZZ Regression Loan (edited)',
      lender: 'Other Bank',
      principal: 120000,
      interestRate: 8.5,
      tenureMonths: 72,
      monthlyEmi: 2130,
      endDate: '2031-12-31',
    });
    check('edit updates every supplied field',
      edited.data?.name === 'ZZ Regression Loan (edited)' &&
      edited.data?.lender === 'Other Bank' &&
      edited.data?.principal === 120000 &&
      edited.data?.interestRate === 8.5 &&
      edited.data?.tenureMonths === 72 &&
      edited.data?.monthlyEmi === 2130);
    check('end date is stored', Boolean(edited.data?.endDate));

    // ── Partial (status-only) edit ────────────────────────
    // The Telegram bot's loan flow sends only status/remainingPrincipal; a
    // partial update must not blank the other columns.
    const statusOnly = await call(`/api/loans/${loanId}`, 'PUT', { status: 'CLOSED' });
    check('status-only update applies', statusOnly.data?.status === 'CLOSED');
    check('status-only update keeps other fields',
      statusOnly.data?.name === 'ZZ Regression Loan (edited)' &&
      statusOnly.data?.monthlyEmi === 2130 &&
      statusOnly.data?.principal === 120000);
    await call(`/api/loans/${loanId}`, 'PUT', { status: 'ACTIVE' });

    // ── Payments ──────────────────────────────────────────
    const p1 = await call(`/api/loans/${loanId}/payment`, 'POST', {
      amount: 2130, principal: 1300, interest: 830, balance: 118700, paidOn: '2026-02-15',
    });
    check('record first payment', p1.status === 200);
    const afterP1 = await getLoan(loanId);
    check('payment sets the outstanding amount', afterP1?.remainingPrincipal === 118700, `got ${afterP1?.remainingPrincipal}`);

    const p2 = await call(`/api/loans/${loanId}/payment`, 'POST', {
      amount: 2130, principal: 1310, interest: 820, balance: 117390, paidOn: '2026-03-15',
    });
    const afterP2 = await getLoan(loanId);
    check('second payment moves it again', afterP2?.remainingPrincipal === 117390, `got ${afterP2?.remainingPrincipal}`);
    check('all payments are returned', Array.isArray(afterP2?.payments) && afterP2.payments.length === 2, `got ${afterP2?.payments?.length}`);

    // ── Remove the newest payment ─────────────────────────
    const p2Id = p2.data?.id;
    const afterDelete = await call(`/api/loans/${loanId}/payments/${p2Id}`, 'DELETE');
    check('deleting a payment restores the previous balance',
      afterDelete.data?.remainingPrincipal === 118700, `got ${afterDelete.data?.remainingPrincipal}`);
    check('one payment remains', afterDelete.data?.payments?.length === 1, `got ${afterDelete.data?.payments?.length}`);

    // ── Remove the last payment ───────────────────────────
    const p1Id = p1.data?.id;
    const afterDeleteAll = await call(`/api/loans/${loanId}/payments/${p1Id}`, 'DELETE');
    check('deleting the last payment restores the principal',
      afterDeleteAll.data?.remainingPrincipal === afterDeleteAll.data?.principal,
      `got ${afterDeleteAll.data?.remainingPrincipal} vs principal ${afterDeleteAll.data?.principal}`);

    // ── Guard: a payment that isn't on this loan ──────────
    const mismatched = await call(`/api/loans/${loanId}/payments/not-a-real-payment-id`, 'DELETE');
    check('unknown payment is rejected', mismatched.status === 404, `got ${mismatched.status}`);

    // ── Delete the loan ───────────────────────────────────
    const deleted = await call(`/api/loans/${loanId}`, 'DELETE');
    check('delete loan', deleted.status === 200);
    loanId = undefined;

    const final = (await call('/api/loans')).data;
    check('cleanup: back to baseline', final.length === baseline.length, `${final.length} loans`);
    check('no test loan left behind', final.every((l) => !l.name.startsWith('ZZ Regression Loan')));
  } finally {
    if (loanId) {
      await call(`/api/loans/${loanId}`, 'DELETE');
      console.log('  (cleaned up the test loan after an early exit)');
    }
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('loan smoke test failed to run:', err);
  process.exit(1);
});
