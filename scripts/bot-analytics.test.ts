/**
 * Tests for telegram-bot/analytics.ts — the parsing and reporting behind the
 * bot's transaction templates.
 *
 *   npm run test:bot
 *
 * Pure functions only: no Telegram, no database. `now` is always injected so
 * the bucket windows are deterministic.
 */
import {
  bucketTrend, fmtINR, formatTxReport, istDay, istDaysAgo, parseAmount, parseTxTemplate,
  periodDays, periodWeeks, summarize, trendReport, type TxLike,
} from '../telegram-bot/analytics.js';

let pass = 0;
let fail = 0;
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`);
  ok ? pass++ : fail++;
};
const ok = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  cond ? pass++ : fail++;
};

// Fixed instant: 2026-09-21 11:30 IST
const NOW = new Date('2026-09-21T06:00:00.000Z');

const tx = (over: Partial<TxLike>): TxLike => ({
  id: Math.random().toString(36).slice(2),
  amount: 100,
  type: 'EXPENSE',
  date: '2026-09-19T00:00:00.000Z',
  description: 'Thing',
  category: { name: 'Other' },
  account: { name: 'Cash' },
  user: { name: 'Kousi', initials: 'K' },
  ...over,
});

console.log('\n  amounts');
eq('500 → 500', parseAmount('500'), 500);
eq('5k → 5000', parseAmount('5k'), 5000);
eq('1.2L → 120000', parseAmount('1.2L'), 120000);
eq('1.2l → 120000', parseAmount('1.2l'), 120000);
eq('50,00,000 → 5000000', parseAmount('50,00,000'), 5000000);
eq('₹250 → 250', parseAmount('₹250'), 250);
eq('1cr → 10000000', parseAmount('1cr'), 10000000);
eq('0 rejected', parseAmount('0'), null);
eq('garbage rejected', parseAmount('abc'), null);

console.log('\n  ist dates');
eq('istDay of a fixed instant', istDay(NOW), '2026-09-21');
eq('istDaysAgo(6)', istDaysAgo(6, NOW), '2026-09-15');
eq('istDaysAgo(0)', istDaysAgo(0, NOW), '2026-09-21');
// 2026-09-20T20:00Z is 01:30 IST on the 21st, so it must not read as the 20th
eq('late-UTC counts as the next IST day', istDay(new Date('2026-09-20T20:00:00.000Z')), '2026-09-21');

console.log('\n  templates — the forms that already worked');
{
  const p = parseTxTemplate('spent 500 groceries at Reliance');
  ok('bare "spent" still parses', p && !('error' in p));
  if (p && !('error' in p)) {
    eq('  type', p.type, 'EXPENSE');
    eq('  amount', p.amount, 500);
    eq('  category', p.categoryHint, 'groceries');
    eq('  merchant becomes the description', p.description, 'Reliance');
  }
}
{
  const p = parseTxTemplate('received 50000 salary');
  ok('bare "received" is income', p && !('error' in p) && p.type === 'INCOME' && p.amount === 50000);
}

console.log('\n  templates — explicit types');
{
  const p = parseTxTemplate('expense 401 groceries at Reliance SMART');
  ok('expense', p && !('error' in p) && p.type === 'EXPENSE' && p.amount === 401 && p.description === 'Reliance SMART');
}
{
  const p = parseTxTemplate('income 85000 salary');
  ok('income', p && !('error' in p) && p.type === 'INCOME' && p.categoryHint === 'salary');
}
{
  const p = parseTxTemplate('transfer 10000 from Cash to HDFC (Kousi)');
  ok('transfer with both sides', p && !('error' in p) && p.type === 'TRANSFER' && p.accountHint === 'Cash' && p.toAccountHint === 'HDFC (Kousi)');
}
{
  const p = parseTxTemplate('transfer 10000 to HDFC');
  ok('transfer with only a destination parses', p && !('error' in p) && p.toAccountHint === 'HDFC' && p.accountHint === undefined);
}
{
  const p = parseTxTemplate('transfer 10000');
  ok('transfer without a destination is an error', p !== null && 'error' in p);
}
{
  const p = parseTxTemplate('invest 25000 in Mutual Fund');
  ok('invest', p && !('error' in p) && p.type === 'INVESTMENT_BUY' && p.amount === 25000 && p.description === 'Mutual Fund');
}
{
  const p = parseTxTemplate('sell 15000 in Mutual Fund');
  ok('sell', p && !('error' in p) && p.type === 'INVESTMENT_SELL' && p.description === 'Mutual Fund');
}
{
  const p = parseTxTemplate('loanpay 2076 for Hdfc housing');
  ok('loanpay', p && !('error' in p) && p.type === 'LOAN_PAYMENT' && p.loanHint === 'Hdfc housing' && p.amount === 2076);
}
{
  const p = parseTxTemplate('emi 2076 for Car loan from HDFC (Kousi)');
  ok('loanpay via the "emi" alias, with a source account', p && !('error' in p) && p.type === 'LOAN_PAYMENT' && p.accountHint === 'HDFC (Kousi)');
}
{
  const p = parseTxTemplate('expense abc groceries');
  ok('unreadable amount explains the format', p !== null && 'error' in p && p.error.includes('Amounts accept'));
}
{
  const p = parseTxTemplate('loanpay 2076');
  ok('loanpay without a loan is an error', p !== null && 'error' in p);
}
eq('unrelated text is left alone', parseTxTemplate('balance'), null);
eq('a greeting is left alone', parseTxTemplate('hello there'), null);

console.log('\n  summaries');
{
  const s = summarize([
    tx({ type: 'EXPENSE', amount: 400, category: { name: 'Groceries' } }),
    tx({ type: 'EXPENSE', amount: 100, category: { name: 'Fuel' } }),
    tx({ type: 'INCOME', amount: 5000 }),
    tx({ type: 'TRANSFER', amount: 999, category: null }),
  ]);
  eq('expenses totalled', s.expense, 500);
  eq('income totalled', s.income, 5000);
  eq('net', s.net, 4500);
  eq('transfers are excluded and categories ranked', s.byCategory, [
    { name: 'Groceries', total: 400 },
    { name: 'Fuel', total: 100 },
  ]);
}

console.log('\n  trend buckets');
{
  const txs = [
    tx({ date: '2026-09-19T00:00:00.000Z', amount: 100 }),
    tx({ date: '2026-09-02T00:00:00.000Z', amount: 50 }),
    tx({ date: '2026-08-10T00:00:00.000Z', amount: 300 }),
    tx({ date: '2026-03-01T00:00:00.000Z', amount: 999 }), // outside a 6-month window
    tx({ date: '2026-09-05T00:00:00.000Z', type: 'INCOME', amount: 1000 }),
    tx({ date: '2026-09-06T00:00:00.000Z', type: 'TRANSFER', amount: 700, category: null }),
  ];
  const b = bucketTrend(txs, 'monthly', NOW);
  eq('six monthly buckets', b.map((x) => x.label), ['Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026']);
  eq('September expenses summed', b[5].expense, 150);
  eq('August expenses summed', b[4].expense, 300);
  eq('income bucketed', b[5].income, 1000);
  eq('out-of-window rows ignored', b.reduce((s, x) => s + x.expense, 0), 450);
  eq('transfers are not expenditure', b[5].expense, 150);

  const q = bucketTrend(txs, 'quarterly', NOW);
  eq('four quarterly buckets', q.map((x) => x.label), ['Q4 2025', 'Q1 2026', 'Q2 2026', 'Q3 2026']);
  eq('Q3 holds July–September', q[3].expense, 450);

  const h = bucketTrend(txs, 'half', NOW);
  eq('four half-year buckets', h.map((x) => x.label), ['H1 2025', 'H2 2025', 'H1 2026', 'H2 2026']);
  eq('H2 2026 expense', h[3].expense, 450);

  const y = bucketTrend(txs, 'yearly', NOW);
  eq('three yearly buckets', y.map((x) => x.label), ['2024', '2025', '2026']);
  // Unlike the 6-month window, the March row IS inside the 2026 bucket:
  // 100 + 50 + 300 + 999
  eq('2026 expense', y[2].expense, 1449);
}

console.log('\n  reports');
{
  const txs = [tx({ amount: 120, description: 'Auto ride', category: { name: 'Transport' } })];
  const r = formatTxReport(txs, 'Last 7 days', { userLabel: 'K' });
  ok('report has the title and scope', r.includes('Last 7 days') && r.includes('K'));
  ok('report shows outgoing total', r.includes(fmtINR(120)));
  ok('report lists the transaction', r.includes('Auto ride') && r.includes('Transport'));
  ok('singular wording for one row', r.includes('1 transaction:'));
}
{
  const r = formatTxReport([], 'Last 7 days');
  ok('empty report says so', r.includes('Nothing found'));
}
{
  const many = Array.from({ length: 20 }, (_, i) => tx({ description: `Row ${i}` }));
  const r = formatTxReport(many, 'All', { maxLines: 5 });
  ok('long lists are truncated', r.includes('…and 15 more'));
}
{
  const r = trendReport(
    [tx({ date: '2026-09-10T00:00:00.000Z', amount: 1000 }), tx({ date: '2026-08-10T00:00:00.000Z', amount: 500 })],
    'monthly',
    { now: NOW },
  );
  ok('trend names the granularity', r.includes('Monthly expenditure trend'));
  ok('trend draws bars', r.includes('█'));
  ok('trend shows a total', r.includes('Total'));
}
{
  const r = trendReport([], 'yearly', { now: NOW });
  ok('empty trend says so', r.includes('No transactions'));
}

console.log('\n  periods');
{
  const p = periodDays(7, NOW);
  eq('7-day window starts six days back', p.from, '2026-09-15');
  eq('and ends today', p.to, '2026-09-21');
  eq('title', p.title, 'Last 7 days');
}
eq('1 day is "Today"', periodDays(1, NOW).from, '2026-09-21');
eq('weeks convert to days', periodWeeks(2, NOW).from, '2026-09-08');
eq('4 weeks back', periodWeeks(4, NOW).from, '2026-08-25');

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
