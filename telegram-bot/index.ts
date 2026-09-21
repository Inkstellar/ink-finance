import 'dotenv/config';
import { Telegraf, Markup, type Context } from 'telegraf';
import { message } from 'telegraf/filters';
import type { Update } from 'telegraf/types';
import { analyzeReceipt, DEFAULT_CATEGORIES } from './ai-vision';
import { FinanceApiClient } from './api-client';
import { todayIST } from './dates';
import {
  formatTxReport, parseAmount, parseTxTemplate,
  periodDays, periodWeeks, trendReport, TX_TYPES,
  type Granularity, type TxDraft,
} from './analytics';
import type {
  PendingTransaction, PendingLoan, ReceiptAnalysis, FinUser, TransactionRow,
} from './types';
import { planTelegramLink } from './link';

// ── Config ────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN!;
const API_URL   = process.env.VITE_API_URL || 'http://localhost:3456';
const WEB_URL   = process.env.WEB_URL || API_URL.replace(':3456', ':5179');
const ALLOWED   = process.env.BOT_ALLOWED_USERS
  ? process.env.BOT_ALLOWED_USERS.split(',').map(s => parseInt(s.trim()))
  : [];

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is not set in .env');
  process.exit(1);
}

// ── Command registry ──────────────────────────────────────
// Published to Telegram via setMyCommands so "/" shows the menu, and rendered
// by /help — one source of truth, so the two cannot drift.
const COMMANDS = [
  { command: 'start',      description: 'Welcome message and quick intro' },
  { command: 'help',       description: 'All commands and transaction templates' },
  { command: 'recent',     description: 'Latest transactions — /recent 20 K' },
  { command: 'week',       description: 'This past week — /week or /week P' },
  { command: 'weeks',      description: 'The last N weeks — /weeks 4' },
  { command: 'trend',      description: 'Spending trend — /trend quarterly K' },
  { command: 'balance',    description: 'Show dashboard summary' },
  { command: 'loan',       description: 'Add a loan — /loan 5000000 -> Housing -> Kousi' },
  { command: 'categories', description: 'List all categories' },
  { command: 'setup',      description: 'Create default categories and accounts' },
];

// ── State ──────────────────────────────────────────────────
const api = new FinanceApiClient(API_URL);
const pending = new Map<string, PendingTransaction>();
const PENDING_TTL = 5 * 60 * 1000; // 5 minutes

// Track which step each pending transaction is at: 'user' | 'account'
const pendingStep = new Map<string, 'user' | 'account' | 'transferTo'>();

// Loan drafts mid-way through the /loan workflow, and how far along each is
const loanDrafts = new Map<string, PendingLoan>();
type LoanStep = 'tenure' | 'rate' | 'confirm';
const loanStep = new Map<string, LoanStep>();

// Generate a short unique ID for pending transactions
function shortId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Format currency
function fmt(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Category helpers ──────────────────────────────────────

async function ensureCategories() {
  const cats = await api.getCategories();
  if (cats.length > 0) return cats;

  // Create default categories
  const created: Awaited<ReturnType<typeof api.createCategory>>[] = [];
  for (const name of DEFAULT_CATEGORIES) {
    const type = ['Salary', 'Refund'].includes(name) ? 'INCOME' : 'EXPENSE';
    created.push(await api.createCategory({ name, type }));
  }
  console.log(`[setup] Created ${created.length} default categories`);
  return created;
}

async function matchOrCreateCategory(
  name: string,
  type: string,
): Promise<string | undefined> {
  const cats = await api.getCategories();
  if (cats.length === 0) await ensureCategories();
  const all = await api.getCategories();

  // Try exact match (case-insensitive)
  const exact = all.find(
    c => c.name.toLowerCase() === name.toLowerCase(),
  );
  if (exact) return exact.id;

  // Try partial match
  const partial = all.find(
    c =>
      c.name.toLowerCase().includes(name.toLowerCase()) ||
      name.toLowerCase().includes(c.name.toLowerCase()),
  );
  if (partial) return partial.id;

  // Create new category
  const created = await api.createCategory({
    name,
    type: type === 'INCOME' ? 'INCOME' : 'EXPENSE',
  });
  console.log(`[category] Created new category: ${name} (${type})`);
  return created.id;
}

// ── Loans ─────────────────────────────────────────────────
// Template:  loan <amount> -> <type> -> <owner> [-> <lender>]
// e.g.       loan 5000000 -> Housing -> Kousi -> HDFC Bank
// The bot then asks for the tenure and interest rate, computes the
// EMI, and saves the loan.

interface LoanTypePreset {
  label: string;      // shown to the user
  name: string;       // stored as the loan's name
  rate: number;       // suggested annual rate (%)
  tenure: number;     // suggested tenure (months)
  aliases: string[];  // accepted in the template
}

const LOAN_TYPES: LoanTypePreset[] = [
  { label: 'Housing',   name: 'Housing Loan',   rate: 8.5, tenure: 240, aliases: ['housing', 'home', 'house', 'mortgage'] },
  { label: 'Car',       name: 'Car Loan',       rate: 9.5, tenure: 84,  aliases: ['car', 'auto', 'vehicle', 'bike', 'two-wheeler'] },
  { label: 'Personal',  name: 'Personal Loan',  rate: 12,  tenure: 36,  aliases: ['personal'] },
  { label: 'Education', name: 'Education Loan', rate: 10,  tenure: 60,  aliases: ['education', 'edu', 'student'] },
  { label: 'Gold',      name: 'Gold Loan',      rate: 11,  tenure: 24,  aliases: ['gold'] },
  { label: 'Business',  name: 'Business Loan',  rate: 13,  tenure: 48,  aliases: ['business'] },
  { label: 'Other',     name: 'Loan',           rate: 10,  tenure: 36,  aliases: ['other', 'misc'] },
];

const TENURE_OPTIONS = [12, 24, 36, 60, 84, 120, 180, 240];
const RATE_OPTIONS   = [7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 12, 13, 14, 15];

/** Split the template on any of: -> → => > | (commas are NOT separators, so "50,00,000" stays intact) */
const LOAN_ARROW = /\s*(?:->|→|=>|>|\|)\s*/;

/** Matches a message that is trying to use the loan template (bare text or /loan). */
const LOAN_PREFIX = /^\/?loan(?:@[\w_]+)?\b/i;

const LOAN_USAGE =
  `🏦 *Add a loan*\n\n` +
  `\`loan <amount> -> <type> -> <owner>\`\n\n` +
  `Examples:\n` +
  `\`loan 5000000 -> Housing -> Kousi\`\n` +
  `\`loan 8L -> Car -> Preeti -> HDFC Bank\`\n\n` +
  `*Types:* ${LOAN_TYPES.map(t => t.label).join(', ')}\n` +
  `*Owner:* a user set up in the app — match by name or initials (e.g. K or P)\n` +
  `*Lender:* optional 4th part\n\n` +
  `You can use /loan instead of the word "loan". Amounts accept 5L, 50k or 1.2cr.\n\n` +
  `I'll then ask for the tenure and the interest rate and save the loan.`;

function findLoanType(input: string): LoanTypePreset | undefined {
  const q = input.trim().toLowerCase();
  return (
    LOAN_TYPES.find(t => t.label.toLowerCase() === q) ??
    LOAN_TYPES.find(t => t.aliases.includes(q)) ??
    LOAN_TYPES.find(
      t => t.label.toLowerCase().startsWith(q) || t.aliases.some(a => a.startsWith(q)),
    )
  );
}

/** Exact lookup by label — used when re-rendering a draft that already picked a type. */
function loanTypeByLabel(label: string): LoanTypePreset {
  return LOAN_TYPES.find(t => t.label === label) ?? LOAN_TYPES[LOAN_TYPES.length - 1];
}

/** "50,00,000" → 5000000 · "8L" → 800000 · "1.2cr" → 12000000 · "50k" → 50000 */
// parseAmount lives in analytics.ts so the templates and the loan flow share
// exactly one implementation.

/** Reducing-balance EMI. Falls back to a flat split when the rate is 0. */
function calcEmi(principal: number, annualRatePct: number, months: number): number {
  if (months <= 0) return 0;
  const r = annualRatePct / 12 / 100;
  if (r === 0) return principal / months;
  const pow = Math.pow(1 + r, months);
  return (principal * r * pow) / (pow - 1);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Match an owner string against the app's users — initials first, then name. */
function resolveUser(users: FinUser[], raw: string): FinUser | undefined {
  const q = raw.trim().toLowerCase();
  return (
    users.find(u => u.initials.toLowerCase() === q) ??
    users.find(u => u.name.toLowerCase() === q) ??
    users.find(u => u.name.toLowerCase().startsWith(q))
  );
}

interface ParsedLoan {
  amount: number;
  type: LoanTypePreset;
  ownerRaw: string;
  lender?: string;
}

/**
 * Parse the loan template.
 *   null          → the text is not a loan command at all
 *   { error }     → it is a loan command but incomplete / invalid
 *   ParsedLoan    → good to go (owner still needs resolving against real users)
 */
function parseLoanTemplate(text: string): ParsedLoan | { error: string } | null {
  const trimmed = text.trim();
  if (!LOAN_PREFIX.test(trimmed)) return null;

  const body = trimmed.replace(LOAN_PREFIX, '').trim();
  if (!body) return { error: 'usage' };

  const parts = body.split(LOAN_ARROW).map(p => p.trim()).filter(Boolean);
  if (parts.length < 3) return { error: 'usage' };

  const amount = parseAmount(parts[0]);
  if (amount === null) {
    return { error: `I couldn't read the amount "${parts[0]}". Try digits like \`5000000\`, or \`50L\` / \`1.2cr\`.` };
  }

  const type = findLoanType(parts[1]);
  if (!type) {
    return { error: `Unknown loan type "${parts[1]}".\nPick one of: ${LOAN_TYPES.map(t => t.label).join(', ')}.` };
  }

  return {
    amount,
    type,
    ownerRaw: parts[2],
    lender: parts.length > 3 ? parts.slice(3).join(' ') : undefined,
  };
}

// ── Loan prompt rendering ─────────────────────────────────

function tenurePrompt(p: PendingLoan, stepNo = 1): string {
  return (
    `🏦 *New Loan* — step ${stepNo} of 3\n\n` +
    `💰 Principal: *${fmt(p.principal)}*\n` +
    `🏷 Type: ${p.typeLabel}\n` +
    `👤 Owner: ${p.ownerName}\n` +
    (p.lender ? `🏛 Lender: ${p.lender}\n` : '') +
    `📅 Disbursed: ${p.disbursedOn}\n\n` +
    `📆 *Choose the tenure (months):*`
  );
}

function tenureButtons(pid: string, type: LoanTypePreset) {
  const opts = [...new Set([type.tenure, ...TENURE_OPTIONS])].sort((a, b) => a - b);
  const rows = chunk(opts, 4).map(row =>
    row.map(m => Markup.button.callback(m === type.tenure ? `${m} mo ⭐` : `${m} mo`, `loan_t:${pid}:${m}`)),
  );
  rows.push([Markup.button.callback('❌ Cancel', `loan_no:${pid}`)]);
  return rows;
}

function ratePrompt(p: PendingLoan): string {
  return (
    `🏦 *New Loan* — step 2 of 3\n\n` +
    `💰 Principal: *${fmt(p.principal)}*\n` +
    `🏷 Type: ${p.typeLabel}\n` +
    `👤 Owner: ${p.ownerName}\n` +
    `📆 Tenure: ${p.tenureMonths} months\n\n` +
    `📈 *Choose the interest rate (% per annum):*\n` +
    `_Or simply type a rate, e.g._ \`8.75\``
  );
}

function rateButtons(pid: string, type: LoanTypePreset) {
  const opts = [...new Set([type.rate, ...RATE_OPTIONS])].sort((a, b) => a - b);
  const rows = chunk(opts, 4).map(row =>
    row.map(v => Markup.button.callback(v === type.rate ? `${v}% ⭐` : `${v}%`, `loan_r:${pid}:${v}`)),
  );
  rows.push([Markup.button.callback('❌ Cancel', `loan_no:${pid}`)]);
  return rows;
}

function confirmPrompt(p: PendingLoan): string {
  const emi = p.monthlyEmi ?? 0;
  const months = p.tenureMonths ?? 0;
  const totalPayable = emi * months;
  const totalInterest = totalPayable - p.principal;
  return (
    `🏦 *New Loan* — step 3 of 3\n\n` +
    `🏷 ${p.loanName}${p.lender ? ` · ${p.lender}` : ''}\n` +
    `👤 Owner: ${p.ownerName}\n` +
    `💰 Principal: *${fmt(p.principal)}*\n` +
    `📆 Tenure: ${months} months\n` +
    `📈 Interest: ${p.interestRate}% p.a.\n` +
    `💵 Monthly EMI: *${fmt(emi)}*\n` +
    `💸 Total interest: ${fmt(totalInterest)}\n` +
    `🧾 Total payable: ${fmt(totalPayable)}\n` +
    `📅 Disbursed: ${p.disbursedOn}\n\n` +
    `*Save this loan?*`
  );
}

function confirmButtons(pid: string) {
  return [
    [Markup.button.callback('✅ Confirm', `loan_ok:${pid}`)],
    [Markup.button.callback('❌ Cancel', `loan_no:${pid}`)],
  ];
}

/** Store the chosen rate, compute the EMI, and move the draft to the confirm step. */
function applyLoanRate(pid: string, rate: number): PendingLoan {
  const p = loanDrafts.get(pid)!;
  const emi = calcEmi(p.principal, rate, p.tenureMonths ?? 1);
  const updated: PendingLoan = {
    ...p,
    interestRate: rate,
    monthlyEmi: Math.round(emi * 100) / 100,
  };
  loanDrafts.set(pid, updated);
  loanStep.set(pid, 'confirm');
  return updated;
}

/** The draft this Telegram user is currently working on, if any. */
function activeLoanDraft(telegramUserId: number): PendingLoan | undefined {
  for (const draft of loanDrafts.values()) {
    if (draft.telegramUserId === telegramUserId) return draft;
  }
  return undefined;
}

/** The minimal slice of a Telegraf context the loan flow needs. */
interface FlowCtx {
  from: { id: number };
  chat: { id: number };
  reply: (text: string, extra?: any) => Promise<unknown>;
}

/**
 * A context that can only reply — enough for the helper that renders buttons,
 * and satisfied by both message and callback-query contexts.
 */
type ReplyCtx = Pick<FlowCtx, 'reply'>;

/**
 * Kick off the loan flow from a template message.
 * Returns false when the text wasn't a loan command at all.
 */
async function startLoanFlow(ctx: FlowCtx, text: string): Promise<boolean> {
  const parsed = parseLoanTemplate(text);
  if (parsed === null) return false;

  if ('error' in parsed) {
    await ctx.reply(
      parsed.error === 'usage' ? LOAN_USAGE : `❌ ${parsed.error}`,
      { parse_mode: 'Markdown' },
    );
    return true;
  }

  let users: FinUser[] = [];
  try {
    users = await api.getUsers();
  } catch {
    await ctx.reply('❌ Could not reach the API. Is the server running?');
    return true;
  }

  if (users.length === 0) {
    await ctx.reply('⚠️ No users found. Create users in the web UI first.');
    return true;
  }

  const owner = resolveUser(users, parsed.ownerRaw);
  if (!owner) {
    await ctx.reply(
      `❌ I don't know who *${parsed.ownerRaw}* is.\n\n` +
      `Known users: ${users.map(u => `${u.initials} (${u.name})`).join(', ')}`,
      { parse_mode: 'Markdown' },
    );
    return true;
  }

  const pid = shortId();
  const draft: PendingLoan = {
    id: pid,
    telegramUserId: ctx.from.id,
    chatId: ctx.chat.id,
    principal: parsed.amount,
    typeKey: parsed.type.label.toLowerCase(),
    typeLabel: parsed.type.label,
    loanName: parsed.type.name,
    ownerId: owner.id,
    ownerName: owner.name,
    lender: parsed.lender,
    disbursedOn: todayIST(),
    createdAt: Date.now(),
  };
  loanDrafts.set(pid, draft);
  loanStep.set(pid, 'tenure');

  await ctx.reply(tenurePrompt(draft), {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(tenureButtons(pid, parsed.type)),
  });
  return true;
}

// ── Bot setup ─────────────────────────────────────────────
const bot = new Telegraf<Context<Update>>(BOT_TOKEN);

/**
 * Store the sender's numeric Telegram id against their app user.
 *
 * The Bot API cannot send a private message to an `@username` — `sendMessage`
 * answers `400 chat not found` — so a username typed into the Users page looks
 * fine and silently breaks transaction alerts. The numeric id is only knowable
 * while the user is talking to us (`ctx.from.id`), so this repairs the stored
 * value on any message, including the `@username` → id upgrade.
 *
 * Deliberately not memoised. A cache of "already checked" senders would be
 * wrong in a very ordinary sequence: message the bot before setting an id, then
 * add an `@username` on the Users page, and the repair would be skipped until
 * the next restart. One extra lookup per message is a fair price for not
 * silently dropping alerts.
 *
 * Best-effort: a failure here must never stop the update being handled.
 */
async function linkTelegramId(ctx: Context<Update>): Promise<void> {
  const from = ctx.from;
  if (!from || from.is_bot) return;

  try {
    const users = await api.getUsers();
    const plan = planTelegramLink(users, { id: from.id, username: from.username });
    if (!plan) return;

    await api.updateUser(plan.userId, { telegramId: plan.to });
    console.log(`[link] ${plan.name}: ${plan.from} → ${plan.to} (alerts will now reach them)`);
  } catch (err) {
    console.warn('[link] could not update the telegram id:', err instanceof Error ? err.message : err);
  }
}

// Auth middleware
bot.use(async (ctx, next) => {
  const uid = ctx.from?.id;
  if (!uid) return;
  if (ALLOWED.length > 0 && !ALLOWED.includes(uid)) {
    return ctx.reply(
      `⛔ You are not authorised to use this bot.\nYour Telegram ID: ${uid}`,
    );
  }
  // Not awaited: the reply should not wait on a database round trip.
  void linkTelegramId(ctx);
  return next();
});

// ── /start ─────────────────────────────────────────────────
bot.start(async ctx => {
  await ctx.reply(
    `👋 *Welcome to Ink Finance Bot!*\n\n` +
    `📸 Send a photo of a bill, receipt, or UPI payment screenshot —\n` +
    `AI extracts merchant, amount, date and category.\n` +
    `✍️ Or type it: \`spent 500 groceries at Reliance\`\n` +
    `🏦 Or add a loan: \`loan 5000000 -> Housing -> Kousi\`\n\n` +
    `Send /help to see every command.\n\n` +
    `Your Telegram ID: \`${ctx.from.id}\`\n` +
    `Add this to BOT_ALLOWED_USERS in .env to restrict access.`,
    { parse_mode: 'Markdown' },
  );
});

// ── /help ──────────────────────────────────────────────────
bot.help(async ctx => {
  const commandLines = COMMANDS.map(c => `/${c.command} — ${c.description}`).join('\n');

  await ctx.reply(
    `🤖 *Ink Finance Bot — help*\n` +
    `_Everything this bot can do._\n\n` +

    `*⌨️ Commands*\n` +
    `${commandLines}\n\n` +

    `*📸 Add a transaction from a photo*\n` +
    `Send any photo of a bill, receipt, or UPI screenshot (PhonePe / GPay / Paytm / BHIM).\n` +
    `AI reads merchant, amount, date and category, then you pick *who* is adding it (K / P) and *which account* to use.\n\n` +

    `*✍️ Add a transaction by typing*\n` +
    TX_TYPES.map(t => `\`${t.template}\`  — ${t.blurb}`).join('\n') +
    '\n\n' +
    `Examples:\n` +
    `\`spent 500 groceries at Reliance\`\n` +
    `\`income 85000 salary\`\n` +
    `\`transfer 10000 from Cash to HDFC (Kousi)\`\n` +
    `\`invest 25000 in Mutual Fund\`\n` +
    `\`loanpay 2076 for Hdfc housing\`\n\n` +
    `Add \`by K\` (or \`by P\`) to attribute it without being asked.\n` +
    `A transfer moves money between two accounts, and a loan payment also updates that loan.\n\n` +

    `*📊 Reports*\n` +
    `\`/recent 20\` — the latest transactions\n` +
    `\`/week\` — the past 7 days\n` +
    `\`/weeks 4\` — the last N weeks\n` +
    `\`/trend monthly\` · \`quarterly\` · \`half\` · \`yearly\` — spending trend\n\n` +
    `Add a user to any report to scope it: \`/week K\`, \`/trend quarterly Preeti\`.\n` +
    `Leave it off to see everyone.\n\n` +

    `*🏦 Add a loan*\n` +
    `\`loan <amount> -> <type> -> <owner>\`\n` +
    `\`loan 5000000 -> Housing -> Kousi\`\n` +
    `\`loan 8L -> Car -> Preeti -> HDFC Bank\`\n\n` +
    `• Types: ${LOAN_TYPES.map(t => t.label).join(', ')}\n` +
    `• Owner: matched against the app's users (name or initials)\n` +
    `• Lender: optional 4th part\n\n` +
    `The bot then asks for the *tenure* and the *interest rate*, works out the EMI, and saves the loan.\n\n` +

    `_Tip: amounts accept 5L, 50k and 1.2cr as well as plain numbers._`,
    { parse_mode: 'Markdown' },
  );
});

// ── /setup ─────────────────────────────────────────────────
bot.command('setup', async ctx => {
  try {
    const cats = await ensureCategories();
    const accounts = await api.getAccounts();

    let msg = `✅ *Setup complete*\n\n`;
    msg += `📂 Categories: ${cats.length}\n`;

    if (accounts.length === 0) {
      // Create a default Cash account
      await api.createAccount({ name: 'Cash', type: 'CASH', balance: 0 });
      msg += `💳 Created default "Cash" account\n`;
      msg += `\n➕ Create more accounts via the web UI at ${API_URL.replace(':3456', ':5179')}`;
    } else {
      msg += `💳 Accounts: ${accounts.length}\n`;
    }

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('[/setup] Error:', err);
    await ctx.reply('❌ Setup failed. Is the API server running?');
  }
});

// ── /balance ───────────────────────────────────────────────
bot.command('balance', async ctx => {
  try {
    const d = await api.getDashboard();
    await ctx.reply(
      `📊 *Dashboard*\n\n` +
      `💎 Net Worth: ${fmt(d.netWorth)}\n` +
      `💰 Total Balance: ${fmt(d.totalBalance)}\n` +
      `📈 Monthly Income: ${fmt(d.monthlyIncome)}\n` +
      `📉 Monthly Expenses: ${fmt(d.monthlyExpenses)}\n` +
      `🏦 Monthly Savings: ${fmt(d.monthlySavings)}\n` +
      `💳 Accounts: ${d.accountCount}`,
      { parse_mode: 'Markdown' },
    );
  } catch {
    await ctx.reply('❌ Could not fetch dashboard. Is the API server running?');
  }
});

// ── /categories ─────────────────────────────────────────────
bot.command('categories', async ctx => {
  try {
    const cats = await api.getCategories();
    if (cats.length === 0) {
      await ctx.reply('No categories yet. Run /setup to create defaults.');
      return;
    }
    const expense = cats.filter(c => c.type === 'EXPENSE').map(c => `  • ${c.name}`);
    const income  = cats.filter(c => c.type === 'INCOME').map(c => `  • ${c.name}`);
    let msg = `📂 *Categories* (${cats.length})\n\n`;
    if (expense.length) msg += `📉 Expense:\n${expense.join('\n')}\n`;
    if (income.length)  msg += `\n📈 Income:\n${income.join('\n')}\n`;
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch {
    await ctx.reply('❌ Could not fetch categories.');
  }
});

// ── /loan ──────────────────────────────────────────────────
// Same template as the bare-text form:  /loan 5000000 -> Housing -> Kousi
// ── Reports: /recent, /week, /weeks, /trend ────────────────

/**
 * Pull an optional user filter off the end of a command's arguments, so
 * `/week K`, `/recent 20 Preeti` and `/trend quarterly P` all work.
 */
async function takeUserFilter(args: string[]): Promise<{ rest: string[]; user?: FinUser }> {
  if (args.length === 0) return { rest: args };
  const users = await api.getUsers();
  const user = resolveUser(users, args[args.length - 1]);
  if (!user) return { rest: args };
  return { rest: args.slice(0, -1), user };
}

async function sendTxReport(
  ctx: FlowCtx,
  title: string,
  query: { from?: string; to?: string; userId?: string; limit?: number },
  user?: FinUser,
): Promise<void> {
  try {
    const txs = (await api.getTransactions(query)) as unknown as Parameters<typeof formatTxReport>[0];
    await ctx.reply(formatTxReport(txs, title, { userLabel: user?.name }), { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('[report] failed:', err);
    await ctx.reply('❌ Could not fetch transactions. Is the API awake?');
  }
}

bot.command('recent', async ctx => {
  const args = ctx.payload.trim().split(/\s+/).filter(Boolean);
  const { rest, user } = await takeUserFilter(args);
  const parsed = parseInt(rest[0] ?? '', 10);
  const n = Math.min(50, Math.max(1, Number.isFinite(parsed) ? parsed : 10));
  await sendTxReport(ctx, `Latest ${n} transactions`, { userId: user?.id, limit: n }, user);
});

bot.command('week', async ctx => {
  const args = ctx.payload.trim().split(/\s+/).filter(Boolean);
  const { user } = await takeUserFilter(args);
  const p = periodDays(7);
  await sendTxReport(ctx, p.title, { from: p.from, to: p.to, userId: user?.id }, user);
});

bot.command('weeks', async ctx => {
  const args = ctx.payload.trim().split(/\s+/).filter(Boolean);
  const { rest, user } = await takeUserFilter(args);
  const parsed = parseInt(rest[0] ?? '', 10);
  const n = Math.min(52, Math.max(1, Number.isFinite(parsed) ? parsed : 2));
  const p = periodWeeks(n);
  await sendTxReport(ctx, p.title, { from: p.from, to: p.to, userId: user?.id }, user);
});

const GRANULARITIES: Record<string, Granularity> = {
  monthly: 'monthly', month: 'monthly', months: 'monthly', m: 'monthly',
  quarterly: 'quarterly', quarter: 'quarterly', quarters: 'quarterly', q: 'quarterly',
  half: 'half', halfyearly: 'half', 'half-yearly': 'half', 'half-year': 'half',
  semiannual: 'half', h: 'half',
  yearly: 'yearly', year: 'yearly', annual: 'yearly', years: 'yearly', y: 'yearly',
};

bot.command('trend', async ctx => {
  const args = ctx.payload.trim().split(/\s+/).filter(Boolean);
  const { rest, user } = await takeUserFilter(args);
  const word = (rest[0] ?? 'monthly').toLowerCase();
  const granularity = GRANULARITIES[word];

  if (!granularity) {
    await ctx.reply(
      `⚠️ I don't know "${word}".\n\nTry: /trend monthly · /trend quarterly · /trend half · /trend yearly\n` +
      `Add a user to scope it: /trend quarterly K`,
      { parse_mode: 'Markdown' },
    );
    return;
  }

  try {
    // The bucketing drops anything older than the window, so fetching the
    // history and letting it filter is simpler than computing a start date per
    // granularity — and at household volume it is cheap.
    const txs = await api.getTransactions({ userId: user?.id, limit: 1000 });
    await ctx.reply(
      trendReport(txs as unknown as Parameters<typeof trendReport>[0], granularity, {
        userLabel: user?.name,
      }),
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    console.error('[trend] failed:', err);
    await ctx.reply('❌ Could not build the trend. Is the API awake?');
  }
});

// ── Transaction templates ──────────────────────────────────

/** Type-aware one-liner describing what is about to be recorded. */
function draftSummary(p: PendingTransaction): string {
  const icon: Record<string, string> = {
    INCOME: '💚', EXPENSE: '💔', TRANSFER: '🔁',
    INVESTMENT_BUY: '📥', INVESTMENT_SELL: '📤', LOAN_PAYMENT: '🏦',
  };
  return (
    `${icon[p.analysis.type] ?? '•'} *${p.analysis.type.replace(/_/g, ' ')}*\n` +
    `📝 ${p.analysis.merchant}\n` +
    `💰 ${fmt(p.analysis.amount)}\n` +
    `📅 ${p.analysis.date}` +
    (p.analysis.category && p.analysis.category !== '—' ? `\n🏷 ${p.analysis.category}` : '')
  );
}

/** Show the account buttons. `exclude` keeps a transfer from targeting itself. */
async function askForAccount(
  ctx: ReplyCtx,
  pid: string,
  p: PendingTransaction,
  opts: { heading: string; exclude?: string } = { heading: '✅ *Select account:*' },
): Promise<void> {
  const accounts = (await api.getAccounts()).filter(a => a.id !== opts.exclude);
  if (accounts.length === 0) {
    await ctx.reply('⚠️ No usable accounts. Add one on the Accounts page first.');
    return;
  }
  const rows = accounts.map(a => [
    Markup.button.callback(`${a.name} (${fmt(a.balance)})`, `tx:${pid}:${a.id}`),
  ]);
  rows.push([Markup.button.callback('❌ Cancel', `cancel:${pid}`)]);

  await ctx.reply(
    `${draftSummary(p)}\n\n${opts.heading}`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) },
  );
}

/**
 * Turn a parsed template into a pending transaction and start the confirm
 * flow. Reuses the same pending/step machinery as the receipt flow, so the
 * account buttons and confirmation behave identically.
 */
async function startTransactionFromDraft(
  ctx: FlowCtx,
  text: string,
  draft: TxDraft,
): Promise<void> {
  const accounts = await api.getAccounts();
  if (accounts.length === 0) {
    await ctx.reply('⚠️ No accounts yet. Run /setup, or add one on the Accounts page.');
    return;
  }

  // Categories only mean something for expenses and incomes.
  let categoryId: string | undefined;
  if (draft.categoryHint && (draft.type === 'EXPENSE' || draft.type === 'INCOME')) {
    categoryId = await matchOrCreateCategory(draft.categoryHint, draft.type);
  }

  // A loan payment names a loan, and the loan has to move with it.
  let loanId: string | undefined;
  if (draft.type === 'LOAN_PAYMENT') {
    const loans = await api.getLoans();
    if (loans.length === 0) {
      await ctx.reply('⚠️ No loans recorded yet. Add one first — /loan 5000000 -> Housing -> Kousi');
      return;
    }
    const hint = (draft.loanHint ?? draft.description ?? '').toLowerCase();
    const loan =
      loans.find(l => l.name.toLowerCase() === hint) ??
      loans.find(l => l.name.toLowerCase().includes(hint) || hint.includes(l.name.toLowerCase())) ??
      (loans.length === 1 ? loans[0] : undefined);
    if (!loan) {
      await ctx.reply(
        `⚠️ Which loan?\n\nKnown loans: ${loans.map(l => `*${l.name}*`).join(', ')}\n\n` +
        `Retry with e.g. \`loanpay ${draft.amount} for ${loans[0].name}\``,
        { parse_mode: 'Markdown' },
      );
      return;
    }
    loanId = loan.id;
  }

  const users = await api.getUsers();
  const owner = draft.ownerHint ? resolveUser(users, draft.ownerHint) : undefined;

  const pid = shortId();
  const pendingTx: PendingTransaction = {
    id: pid,
    telegramUserId: ctx.from.id,
    chatId: ctx.chat.id,
    messageText: text,
    analysis: {
      merchant: draft.description || (draft.type === 'TRANSFER' ? 'Transfer' : 'Transaction'),
      amount: draft.amount,
      type: draft.type,
      category: draft.categoryHint ?? '—',
      date: todayIST(),
      confidence: 1,
    },
    categoryId,
    userId: owner?.id ?? null,
    loanId,
    createdAt: Date.now(),
  };

  // A named account skips the account picker for expenses/incomes; transfers
  // always ask, because both sides have to be chosen.
  const hintedAccount =
    draft.accountHint && draft.type !== 'TRANSFER'
      ? accounts.find(a => a.name.toLowerCase() === draft.accountHint!.toLowerCase()) ??
        accounts.find(a => a.name.toLowerCase().includes(draft.accountHint!.toLowerCase()))
      : undefined;

  pending.set(pid, pendingTx);

  if (draft.accountHint && draft.type === 'TRANSFER') {
    const source =
      accounts.find(a => a.name.toLowerCase() === draft.accountHint!.toLowerCase()) ??
      accounts.find(a => a.name.toLowerCase().includes(draft.accountHint!.toLowerCase()));
    if (source) {
      pending.set(pid, { ...pendingTx, accountId: source.id });
      pendingStep.set(pid, 'transferTo');
      await askForAccount(ctx, pid, { ...pendingTx, accountId: source.id }, {
        heading: `🔁 From *${source.name}* — now pick the destination:`,
        exclude: source.id,
      });
      return;
    }
  }

  // Owner known → straight to accounts; otherwise ask who it belongs to first.
  if (owner || !draft.accountHint) {
    if (owner) {
      pendingStep.set(pid, 'account');
      await askForAccount(ctx, pid, pendingTx);
      return;
    }
    pendingStep.set(pid, 'user');
    const rows = users.map(u => [Markup.button.callback(`${u.initials} — ${u.name}`, `usr:${pid}:${u.id}`)]);
    rows.push([Markup.button.callback('⏭ Skip', `skip:${pid}`)]);
    await ctx.reply(
      `${draftSummary(pendingTx)}\n\n👤 *Who is this for?*`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) },
    );
    return;
  }

  // Account named, no owner: confirm that account directly.
  pending.set(pid, { ...pendingTx, accountId: hintedAccount?.id });
  pendingStep.set(pid, 'account');
  await askForAccount(ctx, pid, { ...pendingTx, accountId: hintedAccount?.id }, {
    heading: hintedAccount
      ? `✅ Confirm *${hintedAccount.name}* or pick another:`
      : '✅ *Select account:*',
  });
}

bot.command('loan', async ctx => {
  const msg = ctx.message;
  const text = msg && 'text' in msg ? msg.text : '';
  const handled = await startLoanFlow(ctx, text);
  if (!handled) {
    await ctx.reply(LOAN_USAGE, { parse_mode: 'Markdown' });
  }
});

// ── Loan step: tenure chosen ───────────────────────────────
bot.action(/^loan_t:([^:]+):(\d+)$/, async ctx => {
  const pid = ctx.match[1];
  const months = parseInt(ctx.match[2], 10);
  const p = loanDrafts.get(pid);

  if (!p) {
    await ctx.answerCbQuery('⏰ Expired — start again with /loan');
    return;
  }
  if (p.telegramUserId !== ctx.from.id) {
    await ctx.answerCbQuery('⛔ This is not your loan.');
    return;
  }

  await ctx.answerCbQuery();
  const updated: PendingLoan = { ...p, tenureMonths: months };
  loanDrafts.set(pid, updated);
  loanStep.set(pid, 'rate');

  try {
    await ctx.editMessageText(ratePrompt(updated), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(rateButtons(pid, loanTypeByLabel(updated.typeLabel))),
    });
  } catch { /* message too old to edit — buttons stop working, /loan restarts */ }
});

// ── Loan step: interest rate chosen ────────────────────────
bot.action(/^loan_r:([^:]+):([\d.]+)$/, async ctx => {
  const pid = ctx.match[1];
  const rate = parseFloat(ctx.match[2]);
  const p = loanDrafts.get(pid);

  if (!p) {
    await ctx.answerCbQuery('⏰ Expired — start again with /loan');
    return;
  }
  if (p.telegramUserId !== ctx.from.id) {
    await ctx.answerCbQuery('⛔ This is not your loan.');
    return;
  }
  if (p.tenureMonths === undefined) {
    await ctx.answerCbQuery('⚠️ Pick a tenure first.');
    return;
  }

  await ctx.answerCbQuery();
  const updated = applyLoanRate(pid, rate);

  try {
    await ctx.editMessageText(confirmPrompt(updated), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(confirmButtons(pid)),
    });
  } catch { /* message too old to edit */ }
});

// ── Loan step: confirm & save ──────────────────────────────
bot.action(/^loan_ok:([^:]+)$/, async ctx => {
  const pid = ctx.match[1];
  const p = loanDrafts.get(pid);

  if (!p) {
    await ctx.answerCbQuery('⏰ Expired — start again with /loan');
    return;
  }
  if (p.telegramUserId !== ctx.from.id) {
    await ctx.answerCbQuery('⛔ This is not your loan.');
    return;
  }
  if (!p.tenureMonths || !p.interestRate || p.monthlyEmi === undefined) {
    await ctx.answerCbQuery('⚠️ This loan is incomplete — start again with /loan');
    return;
  }

  try {
    await ctx.answerCbQuery('Saving loan...');
    const loan = await api.createLoan({
      name: p.loanName,
      lender: p.lender,
      principal: p.principal,
      interestRate: p.interestRate,
      tenureMonths: p.tenureMonths,
      monthlyEmi: p.monthlyEmi,
      disbursedOn: p.disbursedOn,
      userId: p.ownerId ?? null,
    });

    loanDrafts.delete(pid);
    loanStep.delete(pid);

    await ctx.editMessageText(
      `✅ *Loan saved!*\n\n` +
      `🏷 ${loan.name}${p.lender ? ` · ${p.lender}` : ''}\n` +
      `👤 Owner: ${p.ownerName}\n` +
      `💰 Principal: ${fmt(p.principal)}\n` +
      `📆 ${p.tenureMonths} months @ ${p.interestRate}% p.a.\n` +
      `💵 EMI: ${fmt(p.monthlyEmi)}\n` +
      `🏦 Outstanding: ${fmt(loan.remainingPrincipal)}\n` +
      `📅 Disbursed: ${p.disbursedOn}\n\n` +
      `_See it in the Loans page: ${WEB_URL}_`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    console.error('[loan] create failed:', err);
    await ctx.answerCbQuery('❌ Could not save the loan.');
  }
});

// ── Loan step: cancel ──────────────────────────────────────
bot.action(/^loan_no:([^:]+)$/, async ctx => {
  const pid = ctx.match[1];
  loanDrafts.delete(pid);
  loanStep.delete(pid);
  await ctx.answerCbQuery('Cancelled');
  await ctx.editMessageText('❌ Loan creation cancelled.');
});

// ── Photo handler (the main feature) ──────────────────────
bot.on(message('photo'), async ctx => {
  const photos = ctx.message.photo;
  // Get highest resolution
  const largest = photos[photos.length - 1];

  try {
    // Show "analysing" message
    const processing = await ctx.reply('🔍 Analysing your receipt/bill...');

    // Download the photo
    const fileLink = await bot.telegram.getFileLink(largest.file_id);
    const imgRes = await fetch(fileLink.toString());
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    const base64 = imgBuf.toString('base64');

    // Fetch categories to give the AI better context
    let categories: string[] = [];
    try {
      const cats = await api.getCategories();
      categories = cats.map(c => c.name);
    } catch { /* will use defaults */ }

    // Call AI vision
    const analysis = await analyzeReceipt(base64, categories);

    if (!analysis || analysis.confidence === 0 || analysis.amount === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        processing.message_id,
        undefined,
        '❌ Could not read this image.\nMake sure it’s a clear photo of a bill, receipt, or payment screenshot.',
      );
      return;
    }

    // Match category
    const categoryId = await matchOrCreateCategory(
      analysis.category,
      analysis.type,
    );

    // Fetch accounts and users
    const accounts = await api.getAccounts();
    const users = await api.getUsers();
    if (accounts.length === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        processing.message_id,
        undefined,
        '⚠️ No accounts found.\nRun /setup or create an account in the web UI first.',
      );
      return;
    }

    // Build pending transaction
    const pid = shortId();
    pending.set(pid, {
      id: pid,
      telegramUserId: ctx.from.id,
      chatId: ctx.chat.id,
      messageText: '',
      analysis,
      categoryId,
      createdAt: Date.now(),
    });
    pendingStep.set(pid, 'user');

    // Build confirmation message
    const confidence = analysis.confidence >= 0.8 ? '🟢' : analysis.confidence >= 0.5 ? '🟡' : '🔴';
    let msg = `📋 *Receipt Analysis* ${confidence}\n\n`;
    msg += `🏪 Merchant: *${analysis.merchant}*\n`;
    msg += `💰 Amount: *${fmt(analysis.amount)}*\n`;
    msg += `📅 Date: ${analysis.date}\n`;
    msg += `🏷 Category: ${analysis.category}\n`;
    msg += `📝 Type: ${analysis.type === 'INCOME' ? 'Income 💚' : 'Expense 💔'}\n`;
    if (analysis.paymentMethod)
      msg += `💳 Payment: ${analysis.paymentMethod}\n`;
    msg += `🎯 Confidence: ${(analysis.confidence * 100).toFixed(0)}%\n`;
    if (analysis.rawText)
      msg += `\n📄 _Extracted text:_\n\`${analysis.rawText.slice(0, 500)}\``;
    msg += `\n\n👤 *Who is adding this transaction?*`;

    // Build inline keyboard — one button per user + skip
    const rows = users.map(u => [
      Markup.button.callback(
        `${u.initials} — ${u.name}`,
        `usr:${pid}:${u.id}`,
      ),
    ]);
    rows.push([Markup.button.callback('⏭ Skip', `skip:${pid}`)]);

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      processing.message_id,
      undefined,
      msg,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(rows),
      },
    );
  } catch (err) {
    console.error('[photo] Error:', err);
    await ctx.reply('❌ Error processing image. Please try again.');
  }
});

// ── User selection callback ───────────────────────────────
bot.action(/usr:(.+):(.+)/, async ctx => {
  const pid = ctx.match[1];
  const userId = ctx.match[2];
  const p = pending.get(pid);

  if (!p) {
    await ctx.answerCbQuery('⏰ Expired — send the photo again.');
    return;
  }
  if (p.telegramUserId !== ctx.from.id) {
    await ctx.answerCbQuery('⛔ This is not your transaction.');
    return;
  }
  if (pendingStep.get(pid) !== 'user') {
    await ctx.answerCbQuery('⚠️ Wrong step.');
    return;
  }

  await ctx.answerCbQuery();
  pending.set(pid, { ...p, userId });
  pendingStep.set(pid, 'account');

  // Now show account picker
  const accounts = await api.getAccounts();
  const confidence = p.analysis.confidence >= 0.8 ? '🟢' : p.analysis.confidence >= 0.5 ? '🟡' : '🔴';
  const matchedUser = (await api.getUsers()).find(u => u.id === userId);

  let msg = `👤 *User:* ${matchedUser?.name || '?'}\n`;
  msg += `🏪 *Merchant:* ${p.analysis.merchant}\n`;
  msg += `💰 *Amount:* ${fmt(p.analysis.amount)}\n`;
  msg += `🏷 *Category:* ${p.analysis.category}\n\n`;
  msg += `✅ *Select account to confirm:*`;

  const rows = accounts.map(a => [
    Markup.button.callback(
      `${a.name} (${fmt(a.balance)})`,
      `tx:${pid}:${a.id}`,
    ),
  ]);
  rows.push([Markup.button.callback('❌ Cancel', `cancel:${pid}`)]);

  await ctx.reply(
    msg,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) },
  );
});

// ── Skip user callback ─────────────────────────────────────
bot.action(/skip:(.+)/, async ctx => {
  const pid = ctx.match[1];
  const p = pending.get(pid);
  if (!p || pendingStep.get(pid) !== 'user') return;
  await ctx.answerCbQuery('Skipped');
  // Fall through to account picker with no user
  pendingStep.set(pid, 'account');
});
bot.action(/tx:(.+):(.+)/, async ctx => {
  const pid = ctx.match[1];
  const accountId = ctx.match[2];
  const p = pending.get(pid);

  if (!p) {
    await ctx.answerCbQuery('⏰ Expired — send the photo again.');
    return;
  }
  if (p.telegramUserId !== ctx.from.id) {
    await ctx.answerCbQuery('⛔ This is not your transaction.');
    return;
  }

  // A transfer has two ends: the first pick is the source, so ask for the
  // destination before creating anything.
  if (p.analysis.type === 'TRANSFER' && pendingStep.get(pid) !== 'transferTo') {
    const accounts = await api.getAccounts();
    const source = accounts.find(a => a.id === accountId);
    await ctx.answerCbQuery('Source set');
    pending.set(pid, { ...p, accountId });
    pendingStep.set(pid, 'transferTo');
    await askForAccount(ctx, pid, { ...p, accountId }, {
      heading: `🔁 From *${source?.name ?? 'account'}* — now pick where it goes:`,
      exclude: accountId,
    });
    return;
  }

  try {
    await ctx.answerCbQuery('Creating transaction...');

    const isTransfer = p.analysis.type === 'TRANSFER';
    const fromAccountId = isTransfer ? p.accountId! : accountId;
    const toAccountId = isTransfer ? accountId : undefined;

    // The sender is the actor, which is not necessarily the owner — you can
    // file a receipt on someone else's behalf. The API alerts everyone except
    // the actor, so it has to be told who that is.
    const users = await api.getUsers();
    const sender = users.find(
      u => u.telegramId && String(u.telegramId) === String(ctx.from.id),
    );

    await api.createTransaction({
      amount: p.analysis.amount,
      type: p.analysis.type,
      date: p.analysis.date,
      description: p.analysis.merchant,
      notes: [
        p.analysis.paymentMethod ? `Paid via ${p.analysis.paymentMethod}` : '',
        p.analysis.rawText ? `Receipt text: ${p.analysis.rawText.slice(0, 200)}` : '',
      ].filter(Boolean).join('\n') || undefined,
      accountId: fromAccountId,
      categoryId: p.categoryId,
      userId: p.userId || null,
      ...(toAccountId ? { toAccountId } : {}),
    }, { userId: sender?.id, telegramId: ctx.from.id });

    // A loan payment entered from a template should move the loan too,
    // otherwise the EMI would exist as a transaction but the loan would still
    // show the old outstanding balance. Chat can't know the interest split, so
    // the whole payment is booked as principal.
    let loanNote = '';
    if (p.loanId) {
      const loan = (await api.getLoans()).find(l => l.id === p.loanId);
      if (loan) {
        await api.createLoanPayment(loan.id, {
          amount: p.analysis.amount,
          principal: p.analysis.amount,
          interest: 0,
          balance: Math.max(0, loan.remainingPrincipal - p.analysis.amount),
          paidOn: p.analysis.date,
        });
        loanNote =
          `\n🏦 ${loan.name} → outstanding ${fmt(Math.max(0, loan.remainingPrincipal - p.analysis.amount))}` +
          `\n_Booked as principal; use the Loans page if you need to split interest._`;
      }
    }

    pending.delete(pid);
    pendingStep.delete(pid);

    const accounts = await api.getAccounts();
    const from = accounts.find(a => a.id === fromAccountId);
    const to = toAccountId ? accounts.find(a => a.id === toAccountId) : undefined;
    const user = p.userId ? users.find(u => u.id === p.userId) : undefined;

    await ctx.editMessageText(
      `✅ *${isTransfer ? 'Transfer recorded' : 'Transaction created'}!*\n\n` +
      `👤 ${user?.name || '—'}\n` +
      `📝 ${p.analysis.merchant}\n` +
      `💰 ${fmt(p.analysis.amount)} (${p.analysis.type.replace(/_/g, ' ')})\n` +
      `📅 ${p.analysis.date}\n` +
      (p.categoryId ? `🏷 ${p.analysis.category}\n` : '') +
      (isTransfer
        ? `💳 ${from?.name ?? '—'} → ${to?.name ?? '—'}\n`
        : `💳 ${from?.name ?? 'Account'}\n`) +
      loanNote +
      (isTransfer
        ? `\n${from?.name ?? 'From'}: ${from ? fmt(from.balance) : '—'}\n${to?.name ?? 'To'}: ${to ? fmt(to.balance) : '—'}`
        : `\nNew balance: ${from ? fmt(from.balance) : '—'}`),
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    console.error('[confirm] Error:', err);
    await ctx.answerCbQuery('❌ Failed to create transaction.');
  }
});

// ── Cancel callback ────────────────────────────────────────
bot.action(/cancel:(.+)/, async ctx => {
  const pid = ctx.match[1];
  pending.delete(pid);
  await ctx.answerCbQuery('Cancelled');
  await ctx.editMessageText('❌ Transaction cancelled.');
});

// ── Text handler (manual entry) ────────────────────────────
bot.on(message('text'), async ctx => {
  const text = ctx.message.text.trim();

  // ── Mid-flight loan flow: a bare number answers the rate step ──
  const draft = activeLoanDraft(ctx.from.id);
  if (draft && loanStep.get(draft.id) === 'rate') {
    const rate = parseFloat(text.replace('%', '').trim());
    if (isFinite(rate) && rate >= 0 && rate <= 50) {
      const updated = applyLoanRate(draft.id, rate);
      await ctx.reply(confirmPrompt(updated), {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(confirmButtons(draft.id)),
      });
      return;
    }
  }

  // ── Loan template: "loan 5000000 -> Housing -> Kousi" ──
  if (await startLoanFlow(ctx, text)) return;

  // ── Typed transaction templates ──
  //   expense 500 groceries at Reliance
  //   income 85000 salary
  //   transfer 10000 from Cash to HDFC (Kousi)
  //   invest 25000 in Mutual Fund
  //   sell 15000 in Mutual Fund
  //   loanpay 2076 for Hdfc housing
  // Also handles the older bare forms ("spent 500 groceries at Reliance").
  const parsedDraft = parseTxTemplate(text);
  if (parsedDraft) {
    if ('error' in parsedDraft) {
      await ctx.reply(`⚠️ ${parsedDraft.error}`, { parse_mode: 'Markdown' });
      return;
    }
    await startTransactionFromDraft(ctx, text, parsedDraft);
    return;
  }

  await ctx.reply(
    '📸 Send a photo of a bill/receipt to auto-create a transaction.\n\n' +
    '*Or type a template:*\n' +
    TX_TYPES.map(t => `\`${t.template}\``).join('\n') +
    '\n\n*Or ask for a report:*\n' +
    '`/week` · `/weeks 4` · `/recent 20` · `/trend quarterly`\n' +
    'Add a user to any of them: `/week K`, `/trend monthly P`\n\n' +
    'Send /help for everything I can do.',
    { parse_mode: 'Markdown' },
  );
});

// ── Cleanup expired pending transactions ──────────────────
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of pending) {
    if (now - p.createdAt > PENDING_TTL) {
      pending.delete(id);
      pendingStep.delete(id);
    }
  }
  for (const [id, p] of loanDrafts) {
    if (now - p.createdAt > PENDING_TTL) {
      loanDrafts.delete(id);
      loanStep.delete(id);
    }
  }
}, 60_000);

// ── Health-check HTTP server ──────────────────────────────
// Render (and most PaaS) expect a web service to bind to $PORT.
// This tiny server keeps the service healthy without affecting the bot.
import { createServer } from 'node:http';

const HEALTH_PORT = parseInt(process.env.PORT || '10000', 10);

createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'ink-finance-bot',
      pending: pending.size,
      startedAt: new Date().toISOString(),
    }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  }
}).listen(HEALTH_PORT, () => {
  console.log(`   Health endpoint: http://0.0.0.0:${HEALTH_PORT}/health`);
});

// ── Launch ────────────────────────────────────────────────
// Note: in Telegraf 4.x, bot.launch() only resolves when the bot STOPS,
// so we log synchronously right after calling it.

bot.catch((err, ctx) => {
  console.error('[bot.catch] Update error:', err);
  ctx?.reply?.('❌ Something went wrong. Please try again.').catch(() => {});
});

// Launch with retry — a 409 Conflict is transient during zero-downtime
// deploys (old + new instance overlap while polling getUpdates).
async function launchWithRetry(attempt = 1): Promise<void> {
  try {
    // Publish the command list so Telegram's "/" menu shows every command.
    await bot.telegram
      .setMyCommands(COMMANDS)
      .catch(err =>
        console.warn('⚠️  Could not register the command menu:', err?.message ?? err),
      );
    await bot.launch();
  } catch (err: any) {
    const isConflict = err?.response?.error_code === 409;
    if (isConflict && attempt <= 10) {
      const wait = Math.min(5 * attempt, 30);
      console.warn(
        `⚠️  409 Conflict (another instance polling). Retry ${attempt}/10 in ${wait}s...`,
      );
      await new Promise(r => setTimeout(r, wait * 1000));
      return launchWithRetry(attempt + 1);
    }
    console.error('Failed to launch bot:', err);
    process.exit(1);
  }
}

launchWithRetry();

console.log('🤖 Ink Finance Telegram Bot is running...');
console.log(`   API: ${API_URL}`);
console.log(`   AI:  ${process.env.AI_MODEL} via ${process.env.AI_BASE_URL}`);
if (ALLOWED.length) console.log(`   Allowed users: ${ALLOWED.join(', ')}`);
else console.log('   ⚠️  No user restriction (BOT_ALLOWED_USERS empty — anyone can use the bot)');
console.log('   Send /start to @inkfin_bot in Telegram to begin.');

// ── Graceful shutdown ──────────────────────────────────────
process.once('SIGINT', () => { bot.stop('SIGINT'); process.exit(0); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });
