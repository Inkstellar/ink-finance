/**
 * Pure helpers behind the bot's transaction templates and reports.
 *
 * Deliberately free of Telegraf and Prisma imports so the parsing, bucketing
 * and formatting can be exercised directly (see scripts/bot-analytics.test.ts).
 * Anything that talks to Telegram or the API stays in index.ts.
 */

// ── Domain types (structurally compatible with the API's JSON) ──

export type TxType =
  | 'EXPENSE'
  | 'INCOME'
  | 'TRANSFER'
  | 'INVESTMENT_BUY'
  | 'INVESTMENT_SELL'
  | 'LOAN_PAYMENT';

export interface TxLike {
  id: string;
  amount: number;
  type: string;
  date: string;
  description: string;
  category?: { name: string } | null;
  account?: { name: string } | null;
  user?: { name: string; initials: string } | null;
}

export type Granularity = 'monthly' | 'quarterly' | 'half' | 'yearly';

export interface TxDraft {
  type: TxType;
  amount: number;
  description: string;
  categoryHint?: string;
  accountHint?: string;
  toAccountHint?: string;
  ownerHint?: string;
  loanHint?: string;
}

// ── Amounts ─────────────────────────────────────────────────

/** "50,00,000" → 5000000 · "8L" → 800000 · "1.2cr" → 12000000 · "50k" → 50000 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[,\s₹]/g, '').toLowerCase();
  const m = cleaned.match(/^(\d+(?:\.\d+)?)(k|l|lakh|lac|cr|crore)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n) || n <= 0) return null;
  const mult =
    m[2] === 'k' ? 1e3 : m[2] === 'cr' || m[2] === 'crore' ? 1e7 : m[2] ? 1e5 : 1;
  return Math.round(n * mult * 100) / 100;
}

export const fmtINR = (n: number): string =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Bare amount without decimals, for tight one-line summaries. */
export const fmtShort = (n: number): string =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

// ── Dates, always IST ───────────────────────────────────────

import { IST_TIMEZONE } from './dates';

/** `YYYY-MM-DD` in IST for a given instant. Never use toISOString() — that's UTC. */
export function istDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** The IST day `days` before `from` (negative counts forward). */
export function istDaysAgo(days: number, from: Date = new Date()): string {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() - days);
  return istDay(d);
}

/** IST year/month/day of a stored timestamp, as numbers. */
export function istParts(value: string | Date): { y: number; m: number; d: number } {
  const s = istDay(new Date(value)); // YYYY-MM-DD
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Template parsing ────────────────────────────────────────

interface TypeSpec {
  type: TxType;
  /** Words that introduce a template of this type. */
  words: string[];
  /** How the template reads in help text. */
  template: string;
  blurb: string;
}

export const TX_TYPES: TypeSpec[] = [
  {
    type: 'EXPENSE',
    words: ['expense', 'spent', 'paid', 'exp'],
    template: 'expense <amount> <category> [at <merchant>]',
    blurb: 'Money going out',
  },
  {
    type: 'INCOME',
    words: ['income', 'received', 'got', 'inc'],
    template: 'income <amount> <category> [from <source>]',
    blurb: 'Money coming in',
  },
  {
    type: 'TRANSFER',
    words: ['transfer', 'moved', 'move', 'tr'],
    template: 'transfer <amount> [from <account>] to <other account>',
    blurb: 'Move money between your own accounts',
  },
  {
    type: 'INVESTMENT_BUY',
    words: ['invest', 'buy', 'bought'],
    template: 'invest <amount> in <what> [from <account>]',
    blurb: 'Buying an investment',
  },
  {
    type: 'INVESTMENT_SELL',
    words: ['sell', 'sold', 'redeem'],
    template: 'sell <amount> <what> [to <account>]',
    blurb: 'Selling an investment',
  },
  {
    type: 'LOAN_PAYMENT',
    words: ['loanpay', 'emi', 'loanpayment'],
    template: 'loanpay <amount> for <loan> [from <account>]',
    blurb: 'Paying a loan EMI',
  },
];

/** Words that introduce a template, mapped to the type they mean. */
export function parseTxType(word: string): TxType | undefined {
  const w = word.trim().toLowerCase();
  return TX_TYPES.find((t) => t.words.includes(w))?.type;
}

/**
 * Split off an optional clause introduced by a keyword: `at X`, `from X`,
 * `to X`, `in X`, `for X`, `by X`.
 *
 * The keyword may sit at the very start of the string ("in Mutual Fund" once
 * the amount has been sliced off), so the leading separator is optional — but
 * only at a word boundary, which keeps "invoice" from matching "in".
 */
function takeClause(rest: string, keyword: string): { head: string; value?: string } {
  const re = new RegExp(`(?:^|\\s)(?:${keyword})\\s+(.+)$`, 'i');
  const m = rest.match(re);
  if (!m) return { head: rest.trim() };
  return { head: rest.slice(0, m.index).trim(), value: m[1].trim() };
}

/**
 * Parse a transaction template.
 *
 *   null        → not a transaction template at all (let other handlers try)
 *   { error }   → looks like one, but is incomplete
 *   TxDraft     → parsed; account names are still just hints to resolve
 *
 * Accepts the bare form the bot already supported ("spent 500 groceries at
 * Reliance") as well as the explicit type words.
 */
export function parseTxTemplate(text: string): TxDraft | { error: string } | null {
  const trimmed = text.trim();
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase();
  if (!firstWord) return null;

  const type = parseTxType(firstWord);
  if (!type) return null;

  let rest = trimmed.slice(firstWord.length).trim();
  if (!rest) {
    const spec = TX_TYPES.find((t) => t.type === type)!;
    return { error: `Missing details.\n\nFormat: \`${spec.template}\`` };
  }

  // Destination account before amount handling: "transfer 10000 from A to B"
  let toAccountHint: string | undefined;
  if (type === 'TRANSFER') {
    const withTo = takeClause(rest, 'to');
    toAccountHint = withTo.value;
    rest = withTo.head;
  }

  let accountHint: string | undefined;
  const withFrom = takeClause(rest, 'from');
  accountHint = withFrom.value;
  rest = withFrom.head;

  let ownerHint: string | undefined;
  const withBy = takeClause(rest, 'by');
  ownerHint = withBy.value;
  rest = withBy.head;

  let loanHint: string | undefined;
  if (type === 'LOAN_PAYMENT') {
    const withFor = takeClause(rest, 'for');
    loanHint = withFor.value;
    rest = withFor.head;
  }

  // Amount is the first token
  const amountToken = rest.split(/\s+/)[0];
  const amount = parseAmount(amountToken ?? '');
  if (amount === null) {
    const spec = TX_TYPES.find((t) => t.type === type)!;
    return {
      error: `I couldn't read "${amountToken ?? ''}" as an amount.\n\nFormat: \`${spec.template}\`\nAmounts accept 500, 5k, 1.2L or 1cr.`,
    };
  }
  let tail = rest.slice(amountToken.length).trim();

  // "in <what>" for buys
  let categoryHint: string | undefined;
  let description = tail;

  if (type === 'INVESTMENT_BUY' || type === 'INVESTMENT_SELL') {
    const withIn = takeClause(tail, 'in');
    if (withIn.value) {
      description = withIn.value;
      tail = '';
    } else if (type === 'INVESTMENT_SELL') {
      // "sell 15000 Mutual Fund" — the remainder is the asset
      const withTo = takeClause(tail, 'to');
      if (withTo.value) {
        accountHint = accountHint ?? withTo.value;
        description = withTo.head;
      }
    }
    if (!description) {
      return { error: 'Which investment? e.g. `sell 15000 in Mutual Fund`' };
    }
  } else if (type === 'LOAN_PAYMENT') {
    description = loanHint ?? tail;
    if (!description) return { error: 'Which loan? e.g. `loanpay 2076 for Hdfc housing`' };
  } else {
    // For expenses/incomes the first part is the category, the rest a merchant
    const withAt = takeClause(tail, 'at');
    const merchant = withAt.value;
    const head = withAt.head;
    if (type === 'EXPENSE' || type === 'INCOME') {
      if (head) {
        categoryHint = head.trim();
        description = merchant ?? head.trim();
      } else {
        description = merchant ?? '';
      }
    } else {
      // TRANSFER: whatever is left is a note/label
      description = head || merchant || 'Transfer';
    }
  }

  if (!description && type !== 'TRANSFER') description = '';

  if (type === 'TRANSFER' && !toAccountHint) {
    return {
      error: 'A transfer needs both sides: `transfer 10000 from Cash to HDFC (Kousi)`',
    };
  }

  return {
    type,
    amount,
    description: description || (type === 'TRANSFER' ? 'Transfer' : ''),
    categoryHint,
    accountHint,
    toAccountHint,
    ownerHint,
    loanHint,
  };
}

// ── Summaries ───────────────────────────────────────────────

export interface Summary {
  count: number;
  income: number;
  expense: number;
  net: number;
  byCategory: { name: string; total: number }[];
}

/** Totals for a set of transactions. Transfers are excluded — they net to zero. */
export function summarize(txs: TxLike[]): Summary {
  let income = 0;
  let expense = 0;
  const cats = new Map<string, number>();

  for (const t of txs) {
    if (t.type === 'INCOME') income += t.amount;
    else if (t.type === 'TRANSFER') continue;
    else {
      expense += t.amount;
      const name = t.category?.name ?? 'Uncategorised';
      cats.set(name, (cats.get(name) ?? 0) + t.amount);
    }
  }

  return {
    count: txs.length,
    income,
    expense,
    net: income - expense,
    byCategory: [...cats.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total),
  };
}

const ICON: Record<string, string> = {
  INCOME: '💚',
  EXPENSE: '💔',
  TRANSFER: '🔁',
  INVESTMENT_BUY: '📥',
  INVESTMENT_SELL: '📤',
  LOAN_PAYMENT: '🏦',
};

const SIGN: Record<string, string> = {
  INCOME: '+',
  INVESTMENT_SELL: '+',
  EXPENSE: '-',
  TRANSFER: '→',
  INVESTMENT_BUY: '-',
  LOAN_PAYMENT: '-',
};

/** One line per transaction, kept short enough to read on a phone. */
export function formatTxLine(t: TxLike): string {
  const day = istDay(new Date(t.date)).slice(5).replace('-', '/'); // MM/DD
  const icon = ICON[t.type] ?? '•';
  const sign = SIGN[t.type] ?? '';
  const who = t.user?.initials ? ` ${t.user.initials}` : '';
  const category = t.category?.name ? ` · ${t.category.name}` : '';
  return `${day} ${icon} ${t.description}${who} ${sign}${fmtShort(t.amount)}${category}`;
}

/** A full report: header, totals, category breakdown and the lines themselves. */
export function formatTxReport(
  txs: TxLike[],
  title: string,
  opts: { maxLines?: number; userLabel?: string } = {},
): string {
  const maxLines = opts.maxLines ?? 15;

  if (txs.length === 0) {
    return `📭 *${title}*\n\nNothing found${opts.userLabel ? ` for ${opts.userLabel}` : ''}.`;
  }

  const s = summarize(txs);
  const scope = opts.userLabel ? ` · ${opts.userLabel}` : '';
  const out: string[] = [];

  out.push(`📊 *${title}*${scope}`);
  out.push(
    `${txs.length} transaction${txs.length === 1 ? '' : 's'}: 💔 ${fmtINR(s.expense)} out · 💚 ${fmtINR(s.income)} in · net ${s.net >= 0 ? '+' : ''}${fmtINR(s.net)}`,
  );

  if (s.byCategory.length > 1) {
    out.push('');
    out.push('*Where it went*');
    for (const c of s.byCategory.slice(0, 8)) {
      out.push(`  ${c.name}: ${fmtINR(c.total)}`);
    }
  }

  out.push('');
  out.push(txs.slice(0, maxLines).map(formatTxLine).join('\n'));
  if (txs.length > maxLines) {
    out.push(`_…and ${txs.length - maxLines} more_`);
  }

  return out.join('\n');
}

// ── Trends ──────────────────────────────────────────────────

export interface TrendBucket {
  /** Sortable key, e.g. 2026-09 / 2026-Q3 / 2026-H2 / 2026 */
  key: string;
  label: string;
  expense: number;
  income: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Which bucket a date falls in, for a given granularity. */
function bucketKey(parts: { y: number; m: number }, g: Granularity): string {
  if (g === 'monthly') return `${parts.y}-${pad2(parts.m)}`;
  if (g === 'quarterly') return `${parts.y}-Q${Math.floor((parts.m - 1) / 3) + 1}`;
  if (g === 'half') return `${parts.y}-H${parts.m <= 6 ? 1 : 2}`;
  return String(parts.y);
}

function bucketLabel(key: string, g: Granularity): string {
  if (g === 'monthly') {
    const [y, m] = key.split('-');
    return `${MONTHS[Number(m) - 1]} ${y}`;
  }
  if (g === 'quarterly') {
    const [y, q] = key.split('-');
    return `${q} ${y}`;
  }
  if (g === 'half') {
    const [y, h] = key.split('-');
    return `${h.replace('H', 'H')} ${y}`;
  }
  return key;
}

/** How many buckets to show, most recent last. */
const WINDOW: Record<Granularity, number> = { monthly: 6, quarterly: 4, half: 4, yearly: 3 };

/** The buckets for the last N periods up to `now`, oldest first. */
function emptyBuckets(g: Granularity, now: Date): TrendBucket[] {
  const { y, m } = istParts(now);
  const keys: string[] = [];

  if (g === 'yearly') {
    for (let i = WINDOW.yearly - 1; i >= 0; i--) keys.push(String(y - i));
  } else if (g === 'monthly') {
    for (let i = WINDOW.monthly - 1; i >= 0; i--) {
      const total = y * 12 + (m - 1) - i;
      keys.push(`${Math.floor(total / 12)}-${pad2((total % 12) + 1)}`);
    }
  } else if (g === 'quarterly') {
    const q = Math.floor((m - 1) / 3) + 1;
    for (let i = WINDOW.quarterly - 1; i >= 0; i--) {
      const total = y * 4 + (q - 1) - i;
      keys.push(`${Math.floor(total / 4)}-Q${(total % 4) + 1}`);
    }
  } else {
    const h = m <= 6 ? 1 : 2;
    for (let i = WINDOW.half - 1; i >= 0; i--) {
      const total = y * 2 + (h - 1) - i;
      keys.push(`${Math.floor(total / 2)}-H${(total % 2) + 1}`);
    }
  }

  return keys.map((key) => ({ key, label: bucketLabel(key, g), expense: 0, income: 0 }));
}

/** Aggregate transactions into the recent periods, oldest first. */
export function bucketTrend(
  txs: TxLike[],
  g: Granularity,
  now: Date = new Date(),
): TrendBucket[] {
  const buckets = emptyBuckets(g, now);
  const byKey = new Map(buckets.map((b) => [b.key, b]));

  for (const t of txs) {
    const bucket = byKey.get(bucketKey(istParts(t.date), g));
    if (!bucket) continue; // older than the window
    if (t.type === 'INCOME') bucket.income += t.amount;
    else if (t.type !== 'TRANSFER') bucket.expense += t.amount;
  }

  return buckets;
}

const BAR_WIDTH = 18;

/** Text bar chart of expenses per period, plus totals. */
export function trendReport(
  txs: TxLike[],
  g: Granularity,
  opts: { userLabel?: string; now?: Date } = {},
): string {
  const buckets = bucketTrend(txs, g, opts.now);
  const label = { monthly: 'month', quarterly: 'quarter', half: 'half-year', yearly: 'year' }[g];
  const name = { monthly: 'Monthly', quarterly: 'Quarterly', half: 'Half-yearly', yearly: 'Yearly' }[g];

  const totalExpense = buckets.reduce((s, b) => s + b.expense, 0);
  const totalIncome = buckets.reduce((s, b) => s + b.income, 0);

  if (totalExpense === 0 && totalIncome === 0) {
    return `📈 *${name} trend*\n\nNo transactions in the last ${buckets.length} ${label}s.`;
  }

  const max = Math.max(...buckets.map((b) => b.expense), 1);
  const out: string[] = [];

  out.push(`📈 *${name} expenditure trend*${opts.userLabel ? ` · ${opts.userLabel}` : ''}`);
  out.push('');

  for (const b of buckets) {
    const filled = b.expense === 0 ? 0 : Math.max(1, Math.round((b.expense / max) * BAR_WIDTH));
    const bar = '█'.repeat(filled) + '·'.repeat(BAR_WIDTH - filled);
    out.push(`${b.label.padEnd(8)} ${bar} ${fmtShort(b.expense)}`);
  }

  out.push('');
  const active = buckets.filter((b) => b.expense > 0).length || 1;
  out.push(`Total ${fmtINR(totalExpense)} over ${active} ${label}${active === 1 ? '' : 's'} · average ${fmtINR(totalExpense / active)}`);
  if (totalIncome > 0) {
    out.push(`Income ${fmtINR(totalIncome)} · net ${totalIncome - totalExpense >= 0 ? '+' : ''}${fmtINR(totalIncome - totalExpense)}`);
  }

  return out.join('\n');
}

// ── Period helpers for the query commands ───────────────────

export interface Period {
  title: string;
  from: string; // inclusive, YYYY-MM-DD (IST)
  to: string; // inclusive
}

export function periodDays(days: number, now: Date = new Date()): Period {
  return {
    title: days === 1 ? 'Today' : `Last ${days} days`,
    from: istDaysAgo(days - 1, now),
    to: istDay(now),
  };
}

export function periodWeeks(weeks: number, now: Date = new Date()): Period {
  return { title: weeks === 1 ? 'Last week' : `Last ${weeks} weeks`, from: istDaysAgo(weeks * 7 - 1, now), to: istDay(now) };
}
