import 'dotenv/config';
import { Telegraf, Markup, type Context } from 'telegraf';
import { message } from 'telegraf/filters';
import type { Update } from 'telegraf/types';
import { analyzeReceipt, DEFAULT_CATEGORIES } from './ai-vision.js';
import { FinanceApiClient } from './api-client.js';
import type { PendingTransaction, ReceiptAnalysis } from './types.js';

// ── Config ────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN!;
const API_URL   = process.env.VITE_API_URL || 'http://localhost:3456';
const ALLOWED   = process.env.BOT_ALLOWED_USERS
  ? process.env.BOT_ALLOWED_USERS.split(',').map(s => parseInt(s.trim()))
  : [];

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is not set in .env');
  process.exit(1);
}

// ── State ──────────────────────────────────────────────────
const api = new FinanceApiClient(API_URL);
const pending = new Map<string, PendingTransaction>();
const PENDING_TTL = 5 * 60 * 1000; // 5 minutes

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

// ── Bot setup ─────────────────────────────────────────────
const bot = new Telegraf<Context<Update>>(BOT_TOKEN);

// Auth middleware
bot.use(async (ctx, next) => {
  const uid = ctx.from?.id;
  if (!uid) return;
  if (ALLOWED.length > 0 && !ALLOWED.includes(uid)) {
    return ctx.reply(
      `⛔ You are not authorised to use this bot.\nYour Telegram ID: ${uid}`,
    );
  }
  return next();
});

// ── /start ─────────────────────────────────────────────────
bot.start(async ctx => {
  await ctx.reply(
    `👋 *Welcome to Ink Finance Bot!*\n\n` +
    `📸 Send a photo of a bill, receipt, or UPI payment screenshot.\n` +
    `🤖 AI will extract merchant, amount, date, and category.\n` +
    `✅ Tap an account button to confirm the transaction.\n\n` +
    `Your Telegram ID: \`${ctx.from.id}\`\n` +
    `Add this to BOT_ALLOWED_USERS in .env to restrict access.\n\n` +
    `Commands:\n` +
    `/setup — create default categories\n` +
    `/balance — show dashboard summary\n` +
    `/categories — list all categories`,
    { parse_mode: 'Markdown' },
  );
});

// ── /help ──────────────────────────────────────────────────
bot.help(async ctx => {
  await ctx.reply(
    `📸 *How to use*\n\n` +
    `1. Take a photo of your bill/receipt/payment screenshot\n` +
    `2. Send it to this chat\n` +
    `3. AI extracts: merchant, amount, date, category\n` +
    `4. Pick the account to debit/credit\n` +
    `5. Transaction is created automatically!\n\n` +
    `Works with: paper receipts, UPI screenshots (PhonePe/GPay/Paytm), bills, invoices`,
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

    // Fetch accounts
    const accounts = await api.getAccounts();
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
    msg += `\n\n✅ *Select account to confirm:*`;

    // Build inline keyboard — one button per account + cancel
    const rows = accounts.map(a => [
      Markup.button.callback(
        `${a.name} (${fmt(a.balance)})`,
        `tx:${pid}:${a.id}`,
      ),
    ]);
    rows.push([Markup.button.callback('❌ Cancel', `cancel:${pid}`)]);

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

// ── Transaction confirmation callback ─────────────────────
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

  try {
    await ctx.answerCbQuery('Creating transaction...');

    const tx = await api.createTransaction({
      amount: p.analysis.amount,
      type: p.analysis.type,
      date: p.analysis.date,
      description: p.analysis.merchant,
      notes: [
        p.analysis.paymentMethod ? `Paid via ${p.analysis.paymentMethod}` : '',
        p.analysis.rawText ? `Receipt text: ${p.analysis.rawText.slice(0, 200)}` : '',
      ].filter(Boolean).join('\n') || undefined,
      accountId,
      categoryId: p.categoryId,
    });

    pending.delete(pid);

    const account = (await api.getAccounts()).find(a => a.id === accountId);
    await ctx.editMessageText(
      `✅ *Transaction Created!*\n\n` +
      `🏪 ${p.analysis.merchant}\n` +
      `💰 ${fmt(p.analysis.amount)} (${p.analysis.type})\n` +
      `📅 ${p.analysis.date}\n` +
      `🏷 ${p.analysis.category}\n` +
      `💳 ${account?.name || 'Account'}\n\n` +
      `New balance: ${account ? fmt(account.balance) : '—'}`,
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

  // Quick manual entry: "spent 500 groceries at Reliance"
  const match = text.match(
    /^(spent|received|paid|got)\s+(\d+(?:\.\d+)?)\s+(?:for\s+|on\s+|at\s+)?(.+)/i,
  );
  if (!match) {
    await ctx.reply(
      '📸 Send a photo of a bill/receipt to auto-create a transaction.\n\n' +
      'Or type manually:\n`spent 500 groceries at Reliance`\n`received 50000 salary`',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const [, verb, amountStr, rest] = match;
  const amount = parseFloat(amountStr);
  const type = /received|got/i.test(verb) ? 'INCOME' : 'EXPENSE';
  const parts = rest.split(/\s+(?:at|from)\s+/i);
  const category = parts[0]?.trim() || 'Other';
  const merchant = parts[1]?.trim() || parts[0]?.trim() || 'Unknown';

  const categoryId = await matchOrCreateCategory(category, type);
  const accounts = await api.getAccounts();

  if (accounts.length === 0) {
    await ctx.reply('⚠️ No accounts. Run /setup first.');
    return;
  }

  // If single account, create directly
  if (accounts.length === 1) {
    try {
      await api.createTransaction({
        amount, type,
        date: new Date().toISOString().slice(0, 10),
        description: merchant,
        accountId: accounts[0].id,
        categoryId,
      });
      await ctx.reply(
        `✅ ${type === 'INCOME' ? 'Income' : 'Expense'} of ${fmt(amount)} → ${merchant} (${category})`,
      );
    } catch {
      await ctx.reply('❌ Failed to create transaction.');
    }
    return;
  }

  // Multiple accounts — show selection
  const pid = shortId();
  pending.set(pid, {
    id: pid,
    telegramUserId: ctx.from.id,
    chatId: ctx.chat.id,
    messageText: text,
    analysis: {
      merchant, amount, type, category,
      date: new Date().toISOString().slice(0, 10),
      confidence: 1,
    },
    categoryId,
    createdAt: Date.now(),
  });

  const rows = accounts.map(a => [
    Markup.button.callback(
      `${a.name} (${fmt(a.balance)})`,
      `tx:${pid}:${a.id}`,
    ),
  ]);
  rows.push([Markup.button.callback('❌ Cancel', `cancel:${pid}`)]);

  await ctx.reply(
    `Confirm: ${type === 'INCOME' ? '💚' : '💔'} ${fmt(amount)} → ${merchant} (${category})\nSelect account:`,
    Markup.inlineKeyboard(rows),
  );
});

// ── Cleanup expired pending transactions ──────────────────
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of pending) {
    if (now - p.createdAt > PENDING_TTL) {
      pending.delete(id);
    }
  }
}, 60_000);

// ── Launch ────────────────────────────────────────────────
// Note: in Telegraf 4.x, bot.launch() only resolves when the bot STOPS,
// so we log synchronously right after calling it.

bot.catch((err, ctx) => {
  console.error('[bot.catch] Update error:', err);
  ctx?.reply?.('❌ Something went wrong. Please try again.').catch(() => {});
});

bot.launch().catch(err => {
  console.error('Failed to launch bot:', err);
  process.exit(1);
});

console.log('🤖 Ink Finance Telegram Bot is running...');
console.log(`   API: ${API_URL}`);
console.log(`   AI:  ${process.env.AI_MODEL} via ${process.env.AI_BASE_URL}`);
if (ALLOWED.length) console.log(`   Allowed users: ${ALLOWED.join(', ')}`);
else console.log('   ⚠️  No user restriction (BOT_ALLOWED_USERS empty — anyone can use the bot)');
console.log('   Send /start to @inkfin_bot in Telegram to begin.');

// ── Graceful shutdown ──────────────────────────────────────
process.once('SIGINT', () => { bot.stop('SIGINT'); process.exit(0); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });
