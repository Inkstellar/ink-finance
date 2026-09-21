/**
 * "Someone added a transaction" alerts, sent over Telegram.
 *
 * Shared by both writers: the API (a transaction entered in the web UI) and the
 * bot (a receipt photo or a typed template). Keeping the wording in one place
 * means the two paths cannot drift into telling you different stories about the
 * same event.
 *
 * Only the recipient list and the transport live here — no Prisma, no knowledge
 * of our own API. Callers pass in the users and the notice.
 *
 * Messages are HTML, not Markdown. Descriptions are free text a person typed
 * ("50% off — *big* sale_"), and Telegram's legacy Markdown breaks on unescaped
 * `*`, `_` and `` ` ``; HTML only needs `&`, `<` and `>` escaped.
 */

/** The transaction types the API stores, as far as a notice cares. */
export type NoticeType =
  | 'INCOME'
  | 'EXPENSE'
  | 'TRANSFER'
  | 'INVESTMENT_BUY'
  | 'INVESTMENT_SELL'
  | 'LOAN_PAYMENT';

/** One line of the message, per type: how it reads and which way the money went. */
const TYPE_META: Record<NoticeType, { label: string; emoji: string; sign: 1 | -1 }> = {
  EXPENSE: { label: 'New expense', emoji: '💸', sign: -1 },
  INCOME: { label: 'New income', emoji: '💰', sign: 1 },
  TRANSFER: { label: 'New transfer', emoji: '🔁', sign: -1 },
  INVESTMENT_BUY: { label: 'New investment', emoji: '📈', sign: -1 },
  INVESTMENT_SELL: { label: 'Investment sold', emoji: '📉', sign: 1 },
  LOAN_PAYMENT: { label: 'New loan payment', emoji: '🏦', sign: -1 },
};

/** A user who could receive an alert. */
export interface NotifyUser {
  id: string;
  name: string;
  telegramId?: string | null;
}

/** Everything the message needs about the transaction that was just saved. */
export interface TransactionNotice {
  type: string;
  amount: number;
  /** IST calendar day, `YYYY-MM-DD`. */
  date: string;
  description?: string | null;
  categoryName?: string | null;
  accountName?: string | null;
  /** Destination account, transfers only. */
  toAccountName?: string | null;
  /** Who the transaction is booked against. */
  ownerName?: string | null;
  /** Who actually entered it. */
  actorName?: string | null;
  /** Source account balance after the change. */
  balanceAfter?: number | null;
}

export interface NotifyResult {
  sent: number;
  failed: number;
  /** Why each user was left out, for the log line. */
  skipped: { name: string; reason: string }[];
}

/** `₹1,00,000.00` — Indian digit grouping, matching the web UI and the bot. */
export function formatAmount(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `2026-09-20` → `20 Sep 2026`.
 *
 * Deliberately string surgery, not `new Date(...)`: parsing a bare date yields
 * UTC midnight, which `toLocaleDateString` then renders in the process's zone —
 * the exact bug that put late-night receipts in the previous day.
 */
export function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, year, month, day] = m;
  const name = MONTHS[Number(month) - 1] ?? month;
  return `${Number(day)} ${name} ${year}`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** The alert body, as Telegram HTML. */
export function buildMessage(notice: TransactionNotice): string {
  const meta = TYPE_META[notice.type as NoticeType];
  const label = meta?.label ?? 'New transaction';
  const emoji = meta?.emoji ?? '🆕';
  const sign = meta?.sign === 1 ? '+' : '-';

  const lines = [`${emoji} <b>${label}</b>`, ''];

  lines.push(`💰 <b>${sign}${formatAmount(notice.amount)}</b>`);
  if (notice.description) lines.push(`📝 ${escapeHtml(notice.description)}`);
  if (notice.categoryName) lines.push(`🏷 ${escapeHtml(notice.categoryName)}`);

  if (notice.type === 'TRANSFER') {
    const from = notice.accountName ?? 'account';
    const to = notice.toAccountName ?? 'account';
    lines.push(`💳 ${escapeHtml(from)} → ${escapeHtml(to)}`);
  } else if (notice.accountName) {
    // The web UI writes the owner next to the account ("HDC (Kousi)"), which
    // matters in a shared ledger: the same bank can belong to two people.
    const owner = notice.ownerName ? ` (${escapeHtml(notice.ownerName)})` : '';
    lines.push(`💳 ${escapeHtml(notice.accountName)}${owner}`);
  }

  lines.push(`📅 ${formatDay(notice.date)}`);

  if (typeof notice.balanceAfter === 'number') {
    lines.push(`\n⚖️ ${escapeHtml(notice.accountName ?? 'Balance')} now ${formatAmount(notice.balanceAfter)}`);
  }

  // The point of the alert: who did it.
  lines.push(`\n👤 Added by <b>${escapeHtml(notice.actorName || 'someone')}</b>`);

  return lines.join('\n');
}

/**
 * Who should hear about it.
 *
 * Everyone with a Telegram id except the person who entered the transaction —
 * alerting someone about their own action is noise. The actor is matched on the
 * app user id when we have one (a browser session) and on the Telegram id
 * otherwise (a bot message from someone whose account is not linked yet).
 */
export function selectRecipients(
  users: NotifyUser[],
  actor: { userId?: string | null; telegramId?: string | number | null } = {},
): { recipients: NotifyUser[]; skipped: { name: string; reason: string }[] } {
  const recipients: NotifyUser[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const user of users) {
    const telegramId = user.telegramId?.trim();
    if (!telegramId) {
      skipped.push({ name: user.name, reason: 'no telegram id' });
      continue;
    }
    if (actor.userId && user.id === actor.userId) {
      skipped.push({ name: user.name, reason: 'entered it' });
      continue;
    }
    if (actor.telegramId != null && String(actor.telegramId) === telegramId) {
      skipped.push({ name: user.name, reason: 'entered it' });
      continue;
    }
    recipients.push(user);
  }

  return { recipients, skipped };
}

/**
 * Base URL for the Bot API. Overridable so a test can point it at a local stub
 * instead of messaging a real human.
 */
export function telegramApiBase(): string {
  return (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
}

export interface NotifyOptions {
  users: NotifyUser[];
  notice: TransactionNotice;
  /** The signed-in user, when the API handled the request. */
  actorUserId?: string | null;
  /** The Telegram sender, when the bot handled the request. */
  actorTelegramId?: string | number | null;
  /** Deep link back into the app, shown as a button. */
  webUrl?: string | null;
  botToken?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  /** Abort a slow Telegram after this long, so nothing hangs. */
  timeoutMs?: number;
}

// ── Loans ───────────────────────────────────────────────────
// A loan is not a transaction, but it moves the same money, and the two
// recorded from the web UI do not create one: recording a payment updates the
// loan and nothing else. Without its own alert, the other person never hears.

export type LoanNotice =
  | {
      event: 'created';
      name: string;
      principal: number;
      lender?: string | null;
      interestRate?: number | null;
      tenureMonths?: number | null;
      monthlyEmi?: number | null;
      disbursedOn?: string | null;
      ownerName?: string | null;
      actorName?: string | null;
    }
  | {
      event: 'payment';
      name: string;
      amount: number;
      paymentPrincipal?: number | null;
      paymentInterest?: number | null;
      /** Outstanding after this payment. */
      outstandingAfter: number;
      paidOn: string;
      actorName?: string | null;
    }
  | {
      event: 'deleted';
      name: string;
      principal: number;
      outstanding: number;
      actorName?: string | null;
    };

/** `18` → `18 months`, `24` → `2 years`. */
export function formatTenure(months: number): string {
  if (months % 12 === 0) {
    const years = months / 12;
    return `${years} ${years === 1 ? 'year' : 'years'}`;
  }
  return `${months} months`;
}

export function buildLoanMessage(notice: LoanNotice): string {
  const lines: string[] = [];

  if (notice.event === 'created') {
    lines.push('🏦 <b>New loan</b>', '');
    lines.push(`💵 <b>${formatAmount(notice.principal)}</b>`);
    lines.push(`📝 ${escapeHtml(notice.name)}`);
    if (notice.lender) lines.push(`🏛 ${escapeHtml(notice.lender)}`);

    const terms: string[] = [];
    if (notice.tenureMonths) terms.push(formatTenure(notice.tenureMonths));
    if (typeof notice.interestRate === 'number') terms.push(`at ${notice.interestRate}%`);
    if (typeof notice.monthlyEmi === 'number') terms.push(`EMI ${formatAmount(notice.monthlyEmi)}`);
    if (terms.length) lines.push(`📆 ${escapeHtml(terms.join(' · '))}`);

    if (notice.disbursedOn) lines.push(`🗓 Disbursed ${formatDay(notice.disbursedOn)}`);
    if (notice.ownerName) lines.push(`👤 For ${escapeHtml(notice.ownerName)}`);
    lines.push(`\n✍️ Added by <b>${escapeHtml(notice.actorName || 'someone')}</b>`);
    return lines.join('\n');
  }

  if (notice.event === 'payment') {
    lines.push('🏦 <b>Loan payment</b>', '');
    lines.push(`💸 <b>-${formatAmount(notice.amount)}</b>`);
    lines.push(`📝 ${escapeHtml(notice.name)}`);

    const split: string[] = [];
    if (typeof notice.paymentPrincipal === 'number') {
      split.push(`principal ${formatAmount(notice.paymentPrincipal)}`);
    }
    if (typeof notice.paymentInterest === 'number') {
      split.push(`interest ${formatAmount(notice.paymentInterest)}`);
    }
    if (split.length) lines.push(`   ${escapeHtml(split.join(' · '))}`);

    lines.push(`📉 Outstanding now ${formatAmount(notice.outstandingAfter)}`);
    lines.push(`📅 ${formatDay(notice.paidOn)}`);
    lines.push(`\n✍️ Recorded by <b>${escapeHtml(notice.actorName || 'someone')}</b>`);
    return lines.join('\n');
  }

  // Deleted. Deliberately announced: a shared record of debt disappearing is
  // exactly the sort of change that should not happen quietly.
  lines.push('🏦 <b>Loan deleted</b>', '');
  lines.push(`📝 ${escapeHtml(notice.name)}`);
  lines.push(`💵 Was ${formatAmount(notice.principal)}, outstanding ${formatAmount(notice.outstanding)}`);
  lines.push(`\n✍️ Deleted by <b>${escapeHtml(notice.actorName || 'someone')}</b>`);
  return lines.join('\n');
}

export interface LoanNotifyOptions {
  users: NotifyUser[];
  notice: LoanNotice;
  actorUserId?: string | null;
  actorTelegramId?: string | number | null;
  webUrl?: string | null;
  botToken?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Tell the other users about a loan. Same transport and same guarantees as
 * notifyTransaction — see sendToUsers.
 */
export async function notifyLoan(options: LoanNotifyOptions): Promise<NotifyResult> {
  return sendToUsers({
    ...options,
    text: buildLoanMessage(options.notice),
    label: 'loan',
  });
}

// ── Transport ───────────────────────────────────────────────

/** Everything the sending half needs: who, what, and who to leave out. */
interface SendOptions {
  users: NotifyUser[];
  text: string;
  /** Only used to name the thing in log lines. */
  label: string;
  actorUserId?: string | null;
  actorTelegramId?: string | number | null;
  webUrl?: string | null;
  botToken?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Send one message to everyone who should get it.
 *
 * Never throws: one unreachable recipient must not stop the others, and a
 * notification failure must never be able to fail the write that caused it.
 * The caller gets counts back to log.
 */
async function sendToUsers(options: SendOptions): Promise<NotifyResult> {
  const { recipients, skipped } = selectRecipients(options.users, {
    userId: options.actorUserId,
    telegramId: options.actorTelegramId,
  });

  const result: NotifyResult = { sent: 0, failed: 0, skipped };
  if (recipients.length === 0) return result;

  const token = options.botToken ?? process.env.BOT_TOKEN;
  if (!token) {
    // Silently doing nothing here is what turns a feature into a mystery, so
    // say so loudly and report every recipient as failed.
    console.error(`[notify] BOT_TOKEN is not set — cannot send ${options.label} alerts`);
    result.failed = recipients.length;
    return result;
  }

  const doFetch = options.fetchImpl ?? fetch;
  const button =
    options.webUrl && /^https?:\/\//.test(options.webUrl)
      ? { reply_markup: { inline_keyboard: [[{ text: '🔗 Open in app', url: options.webUrl }]] } }
      : {};

  await Promise.all(
    recipients.map(async (user) => {
      try {
        const res = await doFetch(`${telegramApiBase()}/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: user.telegramId,
            text: options.text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            ...button,
          }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        result.sent++;
      } catch (err) {
        result.failed++;
        const reason = err instanceof Error ? err.message : String(err);
        // The single most likely way this fails in practice, and the one that
        // looks like success until someone notices they were never told: a
        // username is not a chat id. Say so, rather than leaving a bare 400.
        const hint =
          /chat not found/i.test(reason) && String(user.telegramId).startsWith('@')
            ? ` — "${user.telegramId}" is a @username; the Bot API needs the numeric id shown by /start`
            : '';
        console.error(`[notify] could not message ${user.name}: ${reason}${hint}`);
      }
    }),
  );

  return result;
}

/**
 * Send the alert for a transaction.
 *
 * See sendToUsers for the delivery guarantees.
 */
export async function notifyTransaction(options: NotifyOptions): Promise<NotifyResult> {
  return sendToUsers({
    ...options,
    text: buildMessage(options.notice),
    label: 'transaction',
  });
}
