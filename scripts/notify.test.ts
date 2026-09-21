/**
 * Tests for shared/notify.ts — the "someone added a transaction" alert.
 *
 *   npm run test:notify
 *
 * Pure: no Telegram, no database, no network. The transport is injected, so the
 * assertions can be exact about what would have been sent to whom — including
 * that nobody is told about their own entry, which is the part that is easy to
 * get subtly wrong and impossible to notice by hand.
 */
import {
  buildLoanMessage,
  buildMessage,
  escapeHtml,
  formatAmount,
  formatDay,
  formatTenure,
  notifyLoan,
  notifyTransaction,
  selectRecipients,
  telegramApiBase,
  type NotifyUser,
  type TransactionNotice,
} from '../shared/notify.js';

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

const notice = (over: Partial<TransactionNotice> = {}): TransactionNotice => ({
  type: 'EXPENSE',
  amount: 1500,
  date: '2026-09-20',
  description: 'bus ticket',
  categoryName: 'Transport',
  accountName: 'HDC',
  ownerName: 'Kousi',
  actorName: 'Kousi',
  balanceAfter: 48500,
  ...over,
});

const users: NotifyUser[] = [
  { id: 'u1', name: 'Kousi', telegramId: '111' },
  { id: 'u2', name: 'Priya', telegramId: '222' },
  { id: 'u3', name: 'Unlinked', telegramId: null },
  { id: 'u4', name: 'NoId' },
];

/** Records every sendMessage call and can be told to fail for one chat. */
function stubFetch(failFor: (string | number)[] = []) {
  const calls: { url: string; body: any }[] = [];
  const impl = (async (url: any, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), body });
    const chatId = String(body.chat_id);
    if (failFor.map(String).includes(chatId)) {
      return { ok: false, status: 400, text: async () => 'blocked by user' } as any;
    }
    return { ok: true, status: 200, text: async () => '{"ok":true}' } as any;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

async function main() {
  // ── Amounts ──────────────────────────────────────────────
  console.log('\n  amounts');
  eq('rupees with Indian grouping', formatAmount(1500), '₹1,500.00');
  eq('lakh grouping, not thousands', formatAmount(100000), '₹1,00,000.00');
  eq('crore grouping', formatAmount(12345678.5), '₹1,23,45,678.50');
  eq('paise are kept', formatAmount(0.5), '₹0.50');

  // ── Dates ────────────────────────────────────────────────
  console.log('\n  dates');
  eq('a plain day', formatDay('2026-09-20'), '20 Sep 2026');
  eq('single-digit day has no leading zero', formatDay('2026-01-05'), '5 Jan 2026');
  eq('december does not roll over', formatDay('2026-12-31'), '31 Dec 2026');
  eq('a full timestamp still resolves to its day', formatDay('2026-03-09T00:00:00.000Z'), '9 Mar 2026');
  eq('something unparseable is passed through', formatDay('not a date'), 'not a date');

  // ── Escaping ─────────────────────────────────────────────
  console.log('\n  escaping');
  eq('the three HTML characters', escapeHtml('a & b < c > d'), 'a &amp; b &lt; c &gt; d');
  eq('markdown characters are left alone', escapeHtml('50% off *big* _sale_'), '50% off *big* _sale_');
  eq('ampersands are not double-escaped into nonsense', escapeHtml('&amp;'), '&amp;amp;');

  // ── Message body ─────────────────────────────────────────
  console.log('\n  message body');
  {
    const text = buildMessage(notice());
    ok('names the type', text.includes('New expense'), text.split('\n')[0]);
    ok('shows the amount as an outflow', text.includes('💸') && text.includes('-₹1,500.00'));
    ok('shows the description', text.includes('bus ticket'));
    ok('shows the category', text.includes('🏷 Transport'));
    ok('puts the owner next to the account', text.includes('💳 HDC (Kousi)'));
    ok('shows the date', text.includes('20 Sep 2026'));
    ok('shows the new balance', text.includes('now ₹48,500.00'));
    ok('says who added it, in bold', text.includes('Added by <b>Kousi</b>'));
  }
  {
    const text = buildMessage(notice({ type: 'INCOME', amount: 100000, actorName: 'Priya' }));
    ok('income is a credit', text.includes('+₹1,00,000.00'), text.split('\n')[2]);
    ok('income reads as income', text.includes('New income'));
    ok('names the other actor', text.includes('Added by <b>Priya</b>'));
  }
  {
    const text = buildMessage(
      notice({ type: 'TRANSFER', accountName: 'HDC', toAccountName: 'SBI', categoryName: null }),
    );
    ok('a transfer shows both ends', text.includes('💳 HDC → SBI'));
    ok('a transfer does not print an owner', !text.includes('(Kousi)'));
    ok('a missing category is omitted', !text.includes('🏷'));
  }
  {
    const text = buildMessage(
      notice({ description: 'Café <b>bold</b> & "quoted"', categoryName: null, balanceAfter: null }),
    );
    ok('free text cannot inject HTML', text.includes('&lt;b&gt;bold&lt;/b&gt;'), text);
    ok('an ampersand is escaped', text.includes('&amp;'));
    ok('no balance line when there is no balance', !text.includes('⚖️'));
  }
  {
    const text = buildMessage(notice({ description: null, actorName: null }));
    ok('an unknown actor still reads sensibly', text.includes('Added by <b>someone</b>'));
    ok('a missing description is omitted', !text.includes('📝'));
  }
  {
    const text = buildMessage(notice({ type: 'SOMETHING_NEW' }));
    ok('an unknown type falls back instead of crashing', text.includes('New transaction'), text.split('\n')[0]);
  }

  // ── Recipients ───────────────────────────────────────────
  console.log('\n  recipients');
  {
    const r = selectRecipients(users, { userId: 'u1' });
    eq('the actor is left out, the other linked user is not', r.recipients.map((u) => u.name), ['Priya']);
    eq('everyone else is accounted for', r.skipped.map((s) => `${s.name}:${s.reason}`), [
      'Kousi:entered it',
      'Unlinked:no telegram id',
      'NoId:no telegram id',
    ]);
  }
  {
    const r = selectRecipients(users, { telegramId: 222 });
    eq('a telegram id also excludes its user', r.recipients.map((u) => u.name), ['Kousi']);
  }
  {
    const r = selectRecipients(users, { userId: 'u1', telegramId: '222' });
    eq('both identifiers together exclude both', r.recipients.map((u) => u.name), []);
  }
  {
    const r = selectRecipients(users, {});
    eq('an unknown actor alerts every linked user', r.recipients.map((u) => u.name), ['Kousi', 'Priya']);
  }
  {
    const r = selectRecipients(users, { telegramId: '999999' });
    eq('an unrelated telegram id excludes nobody', r.recipients.map((u) => u.name), ['Kousi', 'Priya']);
  }
  {
    const r = selectRecipients(users, { userId: 'u2' });
    eq('the exclusion follows the actor, not the owner', r.recipients.map((u) => u.name), ['Kousi']);
  }
  {
    const r = selectRecipients([{ id: 'x', name: 'Blank', telegramId: '   ' }], {});
    eq('a whitespace telegram id counts as missing', r.recipients.length, 0);
  }

  // ── Loan messages ────────────────────────────────────────
  console.log('\n  loan messages');
  eq('whole years read as years', formatTenure(24), '2 years');
  eq('one year is singular', formatTenure(12), '1 year');
  eq('a partial year stays in months', formatTenure(18), '18 months');
  eq('months below a year stay months', formatTenure(6), '6 months');
  {
    const text = buildLoanMessage({
      event: 'created',
      name: 'Housing loan',
      principal: 5000000,
      lender: 'HDFC Bank',
      interestRate: 8.5,
      tenureMonths: 240,
      monthlyEmi: 43391,
      disbursedOn: '2026-09-20',
      ownerName: 'Kousi',
      actorName: 'Kousi',
    });
    ok('a new loan says so', text.includes('New loan'));
    ok('it shows the principal', text.includes('₹50,00,000.00'));
    ok('it names the loan', text.includes('Housing loan'));
    ok('it names the lender', text.includes('🏛 HDFC Bank'));
    ok('it gives the terms', text.includes('20 years · at 8.5% · EMI ₹43,391.00'), text);
    ok('it dates the disbursal', text.includes('Disbursed 20 Sep 2026'));
    ok('it names who it is for', text.includes('👤 For Kousi'));
    ok('it names who added it', text.includes('Added by <b>Kousi</b>'));
  }
  {
    const text = buildLoanMessage({
      event: 'created', name: 'Top-up', principal: 100000, actorName: null,
    });
    ok('a bare loan still reads', text.includes('Top-up') && text.includes('₹1,00,000.00'));
    ok('no lender line when there is no lender', !text.includes('🏛'));
    ok('no terms line when there are no terms', !text.includes('📆'));
    ok('no owner line when there is no owner', !text.includes('👤 For'));
    ok('an unknown actor still reads', text.includes('Added by <b>someone</b>'));
  }
  {
    const text = buildLoanMessage({
      event: 'payment',
      name: 'Housing loan',
      amount: 43391,
      paymentPrincipal: 40000,
      paymentInterest: 3391,
      outstandingAfter: 4956609,
      paidOn: '2026-09-20',
      actorName: 'Kousi',
    });
    ok('a payment says so', text.includes('Loan payment'));
    ok('it shows the amount as an outflow', text.includes('-₹43,391.00'));
    ok('it splits principal and interest', text.includes('principal ₹40,000.00 · interest ₹3,391.00'), text);
    ok('it shows the new outstanding', text.includes('Outstanding now ₹49,56,609.00'));
    ok('it dates the payment', text.includes('20 Sep 2026'));
    ok('it says recorded, not added', text.includes('Recorded by <b>Kousi</b>'));
  }
  {
    const text = buildLoanMessage({
      event: 'payment',
      name: 'Housing loan',
      amount: 2076,
      outstandingAfter: 100000,
      paidOn: '2026-09-20',
      actorName: 'Preeti',
    });
    ok('no split line when there is no split', !text.includes('principal '));
    ok('a payment without a split still reads', text.includes('-₹2,076.00'));
  }
  {
    const text = buildLoanMessage({
      event: 'deleted',
      name: 'Car loan',
      principal: 800000,
      outstanding: 512000,
      actorName: 'Kousi',
    });
    ok('a deletion says so', text.includes('Loan deleted'));
    ok('it says what was owed', text.includes('Was ₹8,00,000.00, outstanding ₹5,12,000.00'), text);
    ok('it says deleted, not added', text.includes('Deleted by <b>Kousi</b>'));
  }
  {
    const text = buildLoanMessage({
      event: 'created', name: '<b>Rich</b> & Co', principal: 1, actorName: null,
    });
    ok('a loan name cannot inject HTML', text.includes('&lt;b&gt;Rich&lt;/b&gt; &amp; Co'), text);
  }

  // ── Sending ──────────────────────────────────────────────
  console.log('\n  sending');
  {
    const { impl, calls } = stubFetch();
    const res = await notifyTransaction({
      users, notice: notice(), actorUserId: 'u1', botToken: 'TEST', fetchImpl: impl,
    });
    eq('one message sent', res.sent, 1);
    eq('nothing failed', res.failed, 0);
    eq('it went to the other user', calls.map((c) => c.body.chat_id), ['222']);
    eq('the real Bot API is used by default', calls[0].url.startsWith('https://api.telegram.org/botTEST/'), true);
    eq('the method is sendMessage', calls[0].url.endsWith('/sendMessage'), true);
    eq('HTML is requested', calls[0].body.parse_mode, 'HTML');
    ok('the body names the actor', calls[0].body.text.includes('Added by <b>Kousi</b>'));
  }
  {
    const { impl, calls } = stubFetch();
    await notifyTransaction({
      users, notice: notice(), actorUserId: 'u1', botToken: 'TEST', fetchImpl: impl,
      webUrl: 'https://ink-finance-web.onrender.com/transactions',
    });
    eq('a link button is attached when a URL is given', calls[0].body.reply_markup.inline_keyboard[0][0].url,
      'https://ink-finance-web.onrender.com/transactions');
  }
  {
    const { impl, calls } = stubFetch();
    await notifyTransaction({
      users, notice: notice(), actorUserId: 'u1', botToken: 'TEST', fetchImpl: impl, webUrl: '',
    });
    eq('no button when there is no URL', calls[0].body.reply_markup, undefined);
  }
  {
    const { impl, calls } = stubFetch();
    await notifyTransaction({
      users, notice: notice(), actorUserId: 'u1', botToken: 'TEST', fetchImpl: impl, webUrl: 'javascript:alert(1)',
    });
    eq('a non-http URL is refused', calls[0].body.reply_markup, undefined);
  }
  {
    const { impl } = stubFetch(['222']);
    const res = await notifyTransaction({
      users: [users[0], users[1]], notice: notice(), botToken: 'TEST', fetchImpl: impl,
    });
    eq('a blocked recipient is counted as failed', res.failed, 1);
    eq('but the other one still got theirs', res.sent, 1);
  }
  {
    const { impl, calls } = stubFetch();
    // Only the actor is linked, so excluding them leaves nobody.
    const res = await notifyTransaction({
      users: [users[0]], notice: notice(), actorUserId: 'u1', botToken: 'TEST', fetchImpl: impl,
    });
    eq('nobody is told when there is no one to tell', calls.length, 0);
    eq('and that is not an error', res.failed, 0);
    eq('the lone user is reported as skipped', res.skipped.map((s) => s.reason), ['entered it']);
  }
  {
    const { impl, calls } = stubFetch();
    const saved = process.env.BOT_TOKEN;
    delete process.env.BOT_TOKEN;
    const res = await notifyTransaction({ users, notice: notice(), fetchImpl: impl });
    if (saved !== undefined) process.env.BOT_TOKEN = saved;
    eq('a missing token sends nothing', calls.length, 0);
    // Both linked users are treated as failed — silently dropping an alert is
    // the failure mode that makes this feature look like it works when it does
    // not, so it has to be visible in the counts.
    eq('a missing token is reported, not swallowed', res.failed, 2);
  }

  {
    const { impl, calls } = stubFetch();
    const res = await notifyLoan({
      users, actorUserId: 'u1', botToken: 'TEST', fetchImpl: impl,
      webUrl: 'https://ink-finance-web.onrender.com/loans',
      notice: {
        event: 'deleted', name: 'Car loan', principal: 800000, outstanding: 512000, actorName: 'Kousi',
      },
    });
    eq('a loan alert reaches the other user only', calls.map((c) => c.body.chat_id), ['222']);
    eq('it is HTML too', calls[0].body.parse_mode, 'HTML');
    eq('it carries the loan wording', calls[0].body.text.includes('Loan deleted'), true);
    eq('its button points at the loans page',
      calls[0].body.reply_markup.inline_keyboard[0][0].url,
      'https://ink-finance-web.onrender.com/loans');
    eq('and it counts as sent', res.sent, 1);
  }
  {
    const { impl, calls } = stubFetch();
    await notifyLoan({
      users, notice: { event: 'created', name: 'X', principal: 1, actorName: null },
      botToken: 'TEST', fetchImpl: impl,
    });
    eq('a loan alert with no actor tells everyone linked', calls.map((c) => c.body.chat_id), ['111', '222']);
  }
  {
    const { impl, calls } = stubFetch();
    await notifyLoan({
      users, actorTelegramId: '222', botToken: 'TEST', fetchImpl: impl,
      notice: { event: 'created', name: 'X', principal: 1, actorName: null },
    });
    eq('a loan alert excludes the telegram actor', calls.map((c) => c.body.chat_id), ['111']);
  }
  {
    const { impl, calls } = stubFetch();
    await notifyTransaction({
      users, notice: notice(), actorUserId: 'u1', botToken: 'TEST', fetchImpl: impl,
      webUrl: 'https://ink-finance-web.onrender.com/transactions',
    });
    eq('a transaction alert still points at the transactions page',
      calls[0].body.reply_markup.inline_keyboard[0][0].url,
      'https://ink-finance-web.onrender.com/transactions');
  }

  // ── Transport override ───────────────────────────────────
  console.log('\n  transport');
  {
    const saved = process.env.TELEGRAM_API_BASE;
    process.env.TELEGRAM_API_BASE = 'http://127.0.0.1:9999/';
    eq('the base URL can be redirected (trailing slash trimmed)', telegramApiBase(), 'http://127.0.0.1:9999');
    const { impl, calls } = stubFetch();
    await notifyTransaction({ users, notice: notice(), botToken: 'TEST', fetchImpl: impl });
    eq('and the redirect is used for real sends', calls[0].url, 'http://127.0.0.1:9999/botTEST/sendMessage');
    if (saved === undefined) delete process.env.TELEGRAM_API_BASE;
    else process.env.TELEGRAM_API_BASE = saved;
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
