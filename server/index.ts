// Must be the first import: server/auth.ts reads AUTH_SECRET and SERVICE_TOKEN
// at module scope, and ESM evaluates imports in source order.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { ExpressAuth } from '@auth/express';
import { authConfig } from './auth.js';
import { currentUserId, requireApiAuth } from './auth-middleware.js';

const prisma = new PrismaClient();
const app = express();
const PORT = parseInt(process.env.API_PORT || process.env.PORT || '3456', 10);

// Render terminates TLS in front of the service, so honour
// X-Forwarded-Proto — Auth.js uses req.protocol to decide whether it may set
// a `Secure` cookie.
app.set('trust proxy', true);

// The SPA talks to this API same-origin (Vite proxy locally, a static-site
// rewrite in production), so CORS is not needed for normal operation. It is
// kept as a narrow allow-list rather than the previous wide-open `cors()`,
// since the API now carries credentials.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5179')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header: curl, the bot, and same-origin requests.
      if (!origin) return callback(null, true);
      callback(null, ALLOWED_ORIGINS.includes(origin));
    },
    credentials: true,
  }),
);
// The default 100kb body limit is too small for a profile picture, which
// arrives as a base64 data URL. The browser downscales to ~256px first
// (~20KB), so 2mb is generous headroom rather than the expected size — and
// PUT /api/users/:id/avatar re-checks the decoded byte length regardless.
app.use(express.json({ limit: '2mb' }));

// ─── Auth.js ────────────────────────────────────────────────
// Mounted BEFORE the gate: signing in must not require being signed in.
// Must come after express.json(), whose parsed body Auth.js re-encodes.
app.use('/api/auth/*', ExpressAuth(authConfig));

// ─── Everything below requires a session or the service token ───
app.use('/api', requireApiAuth);

// ─── Health ─────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ink-finance' });
});

// ─── Accounts ──────────────────────────────────────────────

app.get('/api/accounts', async (req, res) => {
  // Archived accounts are hidden everywhere else (transaction pickers, the bot,
  // the dashboard), so the Accounts page opts in explicitly to manage them.
  const includeArchived = req.query.includeArchived === 'true';
  const accounts = await prisma.finAccount.findMany({
    ...(includeArchived ? {} : { where: { archived: false } }),
    orderBy: { createdAt: 'asc' },
  });
  res.json(accounts);
});

app.post('/api/accounts', async (req, res) => {
  const { name, type, balance, currency, notes } = req.body;
  const account = await prisma.finAccount.create({
    data: { name, type, balance: balance || 0, currency: currency || 'INR', notes },
  });
  res.json(account);
});

app.put('/api/accounts/:id', async (req, res) => {
  const { id } = req.params;
  const { name, type, balance, currency, notes, archived } = req.body;
  const account = await prisma.finAccount.update({
    where: { id },
    data: { name, type, balance, currency, notes, archived },
  });
  res.json(account);
});

app.delete('/api/accounts/:id', async (req, res) => {
  const { id } = req.params;
  await prisma.finAccount.update({
    where: { id },
    data: { archived: true },
  });
  res.json({ success: true });
});

// ─── Users ─────────────────────────────────────────────────

/**
 * Fields safe to send to a client. `passwordHash` must never be included — a
 * bare `findMany` returns every column, which is exactly the leak to avoid.
 */
/**
 * Columns safe to return for a user.
 *
 * `avatarMime` is included so `shapeUser` can report `hasAvatar` — but the
 * `avatar` base64 itself is deliberately NOT here. It is served as bytes from
 * `GET /api/users/:id/avatar` instead, so a JSON list of users doesn't carry
 * tens of kilobytes of image data per row.
 */
const USER_FIELDS = {
  id: true,
  name: true,
  initials: true,
  color: true,
  email: true,
  telegramId: true,
  avatarMime: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Adds `hasPassword`/`hasAvatar` for the UI without exposing the hash, and
 * strips the avatar bookkeeping field the client has no use for.
 */
function shapeUser<T extends { passwordHash?: string | null; avatarMime?: string | null }>(
  user: T,
) {
  const { passwordHash, avatarMime, ...rest } = user;
  return { ...rest, hasPassword: Boolean(passwordHash), hasAvatar: Boolean(avatarMime) };
}

/**
 * Prisma select for a user embedded in another resource (a transaction, a loan,
 * the dashboard).
 *
 * Always use this instead of `include: { user: true }`. A bare `include` returns
 * **every** column of the related row, which quietly shipped `passwordHash`
 * (bcrypt hashes of both users) and the full base64 avatar in every transaction
 * and loan — tens of kilobytes of image per row, and a credential leak.
 */
const EMBEDDED_USER_SELECT = {
  id: true,
  name: true,
  initials: true,
  color: true,
  avatarMime: true,
  updatedAt: true,
} as const;

/** Swaps the embedded user's `avatarMime` for a `hasAvatar` boolean. */
function withPublicUser<T extends { user?: { avatarMime?: string | null } | null }>(row: T) {
  if (!row.user) return row;
  const { avatarMime, ...user } = row.user;
  return { ...row, user: { ...user, hasAvatar: Boolean(avatarMime) } };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Image types accepted for an avatar, and the decoded-size ceiling. */
const AVATAR_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AVATAR_MAX_BYTES = 1_500_000; // ~1.5MB decoded

app.get('/api/users', async (_req, res) => {
  const users = await prisma.finUser.findMany({
    select: { ...USER_FIELDS, passwordHash: true },
    orderBy: { name: 'asc' },
  });
  res.json(users.map(shapeUser));
});

/**
 * The signed-in user.
 *
 * Defined before any `/api/users/:id` route so a literal path can never be
 * swallowed by a parameter. The SPA uses it to render the sidebar avatar
 * without shipping the base64 in the session JWT — that cookie has a ~4KB
 * ceiling and an image would blow straight through it.
 */
app.get('/api/users/me', async (req, res) => {
  const id = currentUserId(req);
  if (!id) return res.status(401).json({ error: 'Not signed in' });

  const user = await prisma.finUser.findUnique({
    where: { id },
    select: { ...USER_FIELDS, passwordHash: true },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(shapeUser(user));
});

/**
 * Serve the avatar as image bytes.
 *
 * Cached by ETag keyed on `updatedAt`, and the client appends `?v=updatedAt`
 * to the URL, so replacing a picture produces a new URL and can never show a
 * stale face. `private` because the response sits behind a session.
 */
app.get('/api/users/:id/avatar', async (req, res) => {
  const user = await prisma.finUser.findUnique({
    where: { id: req.params.id },
    select: { avatar: true, avatarMime: true, updatedAt: true },
  });
  if (!user?.avatar || !user.avatarMime) {
    return res.status(404).json({ error: 'No avatar set' });
  }

  const bytes = Buffer.from(user.avatar, 'base64');
  const etag = `"${user.updatedAt.getTime()}-${bytes.length}"`;

  res.set({
    'Content-Type': user.avatarMime,
    'Content-Length': String(bytes.length),
    'Cache-Control': 'private, max-age=86400, must-revalidate',
    ETag: etag,
  });
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.end(bytes);
});

/**
 * Set or replace an avatar from a base64 data URL.
 *
 * Any signed-in user may set anyone's picture, matching the password rule: this
 * is a two-person household app, so the alternative is having no way to give
 * the other person a photo.
 */
app.put('/api/users/:id/avatar', async (req, res) => {
  const { id } = req.params;
  const { dataUrl } = req.body ?? {};

  if (typeof dataUrl !== 'string' || !dataUrl) {
    return res.status(400).json({ error: 'Send the image as a base64 data URL' });
  }

  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    return res.status(400).json({ error: 'Expected a base64 image data URL' });
  }
  const mime = match[1].toLowerCase();
  const base64 = match[2].replace(/\s/g, '');

  if (!AVATAR_MIMES.has(mime)) {
    return res
      .status(400)
      .json({ error: `Unsupported image type ${mime}. Use JPEG, PNG or WebP.` });
  }

  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) {
    return res.status(400).json({ error: 'The image is empty' });
  }
  if (bytes.length > AVATAR_MAX_BYTES) {
    const mb = (bytes.length / 1_048_576).toFixed(1);
    return res.status(413).json({
      error: `That image is ${mb}MB. Please use one under 1.5MB.`,
    });
  }

  const exists = await prisma.finUser.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: 'User not found' });

  const user = await prisma.finUser.update({
    where: { id },
    data: { avatar: base64, avatarMime: mime },
    select: { ...USER_FIELDS, passwordHash: true },
  });
  res.json(shapeUser(user));
});

app.delete('/api/users/:id/avatar', async (req, res) => {
  const { id } = req.params;
  const exists = await prisma.finUser.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: 'User not found' });

  const user = await prisma.finUser.update({
    where: { id },
    data: { avatar: null, avatarMime: null },
    select: { ...USER_FIELDS, passwordHash: true },
  });
  res.json(shapeUser(user));
});

app.post('/api/users', async (req, res) => {
  const { name, initials, color, telegramId, email, password } = req.body;

  if (!name) return res.status(400).json({ error: 'Name is required' });

  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  if (normalizedEmail && !EMAIL_RE.test(normalizedEmail)) {
    return res.status(400).json({ error: 'That does not look like an email address' });
  }
  if (password && String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (normalizedEmail) {
    const clash = await prisma.finUser.findUnique({ where: { email: normalizedEmail } });
    if (clash) return res.status(409).json({ error: `${normalizedEmail} is already in use` });
  }

  const user = await prisma.finUser.create({
    data: {
      name,
      initials: initials || name.slice(0, 1).toUpperCase(),
      color: color || '#7c3aed',
      telegramId: telegramId || null,
      email: normalizedEmail,
      passwordHash: password ? await bcrypt.hash(String(password), 12) : null,
    },
    select: { ...USER_FIELDS, passwordHash: true },
  });
  res.json(shapeUser(user));
});

app.put('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const { name, initials, color, telegramId, email, password } = req.body;

  const normalizedEmail =
    email === undefined ? undefined : email ? String(email).trim().toLowerCase() : null;
  if (normalizedEmail && !EMAIL_RE.test(normalizedEmail)) {
    return res.status(400).json({ error: 'That does not look like an email address' });
  }
  if (password && String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (normalizedEmail) {
    const clash = await prisma.finUser.findUnique({ where: { email: normalizedEmail } });
    if (clash && clash.id !== id) {
      return res.status(409).json({ error: `${normalizedEmail} is already in use` });
    }
  }

  const user = await prisma.finUser.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(initials !== undefined ? { initials } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(telegramId !== undefined ? { telegramId: telegramId || null } : {}),
      ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
      ...(password ? { passwordHash: await bcrypt.hash(String(password), 12) } : {}),
    },
    select: { ...USER_FIELDS, passwordHash: true },
  });
  res.json(shapeUser(user));
});

/**
 * Change a password.
 *
 * Changing *your own* requires the current one, so a borrowed session can't be
 * used to lock its owner out. Setting someone else's is allowed for any
 * authenticated user: this is a two-person household app, and the alternative
 * is having no way to give the second person a first password.
 */
app.put('/api/users/:id/password', async (req, res) => {
  const { id } = req.params;
  const { password, currentPassword } = req.body ?? {};

  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const target = await prisma.finUser.findUnique({ where: { id } });
  if (!target) return res.status(404).json({ error: 'User not found' });

  if (currentUserId(req) === id) {
    if (!currentPassword) {
      return res.status(400).json({ error: 'Enter your current password' });
    }
    const ok =
      target.passwordHash && (await bcrypt.compare(String(currentPassword), target.passwordHash));
    if (!ok) return res.status(403).json({ error: 'Current password is incorrect' });
  }

  const user = await prisma.finUser.update({
    where: { id },
    data: { passwordHash: await bcrypt.hash(String(password), 12) },
    select: { ...USER_FIELDS, passwordHash: true },
  });
  res.json(shapeUser(user));
});

app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  if (currentUserId(req) === id) {
    return res.status(400).json({ error: 'You cannot delete the account you are signed in as' });
  }
  await prisma.finUser.delete({ where: { id } });
  res.json({ success: true });
});

// ─── Categories ─────────────────────────────────────────────

app.get('/api/categories', async (_req, res) => {
  const categories = await prisma.finCategory.findMany({
    include: { parent: true },
    orderBy: { name: 'asc' },
  });
  res.json(categories);
});

app.post('/api/categories', async (req, res) => {
  const { name, type, color, icon, parentId } = req.body;
  const category = await prisma.finCategory.create({
    data: { name, type, color: color || '#1976d2', icon, parentId },
  });
  res.json(category);
});

app.delete('/api/categories/:id', async (req, res) => {
  const { id } = req.params;
  await prisma.finCategory.delete({ where: { id } });
  res.json({ success: true });
});

// ─── Transactions ──────────────────────────────────────────

app.get('/api/transactions', async (req, res) => {
  const { accountId, categoryId, type, userId, from, to, limit, offset } = req.query;

  // Dates are stored as UTC midnight of the intended calendar day (see
  // src/lib/format.ts), so an inclusive `to` should be the day itself, not the
  // end of it.
  const dateFilter =
    from || to
      ? {
          ...(from ? { gte: new Date(String(from)) } : {}),
          ...(to ? { lte: new Date(String(to)) } : {}),
        }
      : undefined;

  const transactions = await prisma.finTransaction.findMany({
    where: {
      ...(accountId && { accountId: String(accountId) }),
      ...(categoryId && { categoryId: String(categoryId) }),
      ...(type && { type: String(type) as 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'INVESTMENT_BUY' | 'INVESTMENT_SELL' | 'LOAN_PAYMENT' }),
      ...(userId && { userId: String(userId) }),
      ...(dateFilter && { date: dateFilter }),
    },
    include: { account: true, category: true, user: { select: EMBEDDED_USER_SELECT } },
    orderBy: { date: 'desc' },
    ...(limit && { take: parseInt(String(limit)) }),
    ...(offset && { skip: parseInt(String(offset)) }),
  });
  res.json(transactions.map(withPublicUser));
});

app.post('/api/transactions', async (req, res) => {
  const { amount, type, date, description, notes, accountId, categoryId, userId, toAccountId } = req.body;

  if (!accountId) return res.status(400).json({ error: 'An account is required' });
  if (type === 'TRANSFER' && !toAccountId) {
    return res.status(400).json({ error: 'A transfer needs a destination account' });
  }

  const tx = await prisma.finTransaction.create({
    data: {
      amount,
      type,
      date: new Date(date),
      description,
      notes,
      userId,
      accountId,
      categoryId,
      toAccountId,
    },
    include: { account: true, category: true, user: { select: EMBEDDED_USER_SELECT } },
  });

  // Apply the balance effects. A transfer moves money between two accounts and
  // a sale credits the account, so neither fits a single signed delta on
  // `accountId` — which is why transfers used to leave both balances untouched.
  const credits = type === 'INCOME' || type === 'INVESTMENT_SELL';
  const debits =
    type === 'EXPENSE' || type === 'LOAN_PAYMENT' || type === 'INVESTMENT_BUY' || type === 'TRANSFER';

  if (credits) {
    await prisma.finAccount.update({
      where: { id: accountId },
      data: { balance: { increment: amount } },
    });
  }
  if (debits) {
    await prisma.finAccount.update({
      where: { id: accountId },
      data: { balance: { decrement: amount } },
    });
  }
  if (type === 'TRANSFER' && toAccountId) {
    await prisma.finAccount.update({
      where: { id: toAccountId },
      data: { balance: { increment: amount } },
    });
  }

  res.json(withPublicUser(tx));
});

app.delete('/api/transactions/:id', async (req, res) => {
  const { id } = req.params;
  await prisma.finTransaction.delete({ where: { id } });
  res.json({ success: true });
});

// ─── Budgets ────────────────────────────────────────────────

app.get('/api/budgets', async (req, res) => {
  const { month, year } = req.query;
  const budgets = await prisma.finBudget.findMany({
    where: {
      ...(month && { month: parseInt(String(month)) }),
      ...(year && { year: parseInt(String(year)) }),
    },
    include: { category: true },
  });
  res.json(budgets);
});

app.post('/api/budgets', async (req, res) => {
  const { amount, month, year, categoryId } = req.body;
  const budget = await prisma.finBudget.upsert({
    where: { categoryId_month_year: { categoryId, month, year } },
    create: { amount, month, year, categoryId },
    update: { amount },
    include: { category: true },
  });
  res.json(budget);
});

// ─── Investments ───────────────────────────────────────────

app.get('/api/investments', async (_req, res) => {
  const investments = await prisma.finInvestment.findMany({
    orderBy: { createdAt: 'asc' },
  });
  res.json(investments);
});

app.post('/api/investments', async (req, res) => {
  const { symbol, name, exchange, assetType, quantity, avgBuyPrice, currentPrice, currency, notes } = req.body;
  const inv = await prisma.finInvestment.create({
    data: { symbol, name, exchange, assetType, quantity, avgBuyPrice, currentPrice, currency: currency || 'INR', notes },
  });
  res.json(inv);
});

app.put('/api/investments/:id', async (req, res) => {
  const { id } = req.params;
  const { currentPrice, quantity, notes } = req.body;
  const inv = await prisma.finInvestment.update({
    where: { id },
    data: { currentPrice, quantity, notes },
  });
  res.json(inv);
});

app.delete('/api/investments/:id', async (req, res) => {
  const { id } = req.params;
  await prisma.finInvestment.delete({ where: { id } });
  res.json({ success: true });
});

// ─── Loans ──────────────────────────────────────────────────

app.get('/api/loans', async (_req, res) => {
  const loans = await prisma.finLoan.findMany({
    include: {
      user: { select: EMBEDDED_USER_SELECT },
      // All payments, not a sample: the page shows a payment history and lets
      // you remove a mis-entered one, which needs the full list.
      payments: { orderBy: { paidOn: 'desc' } },
    },
    orderBy: { disbursedOn: 'asc' },
  });
  res.json(loans.map(withPublicUser));
});

app.post('/api/loans', async (req, res) => {
  const { name, lender, principal, interestRate, tenureMonths, monthlyEmi, disbursedOn, endDate, accountId, userId } = req.body;
  const loan = await prisma.finLoan.create({
    data: {
      name,
      lender,
      principal,
      interestRate,
      tenureMonths,
      monthlyEmi,
      disbursedOn: new Date(disbursedOn),
      endDate: endDate ? new Date(endDate) : null,
      remainingPrincipal: principal,
      accountId,
      userId: userId || null,
    },
    include: { user: { select: EMBEDDED_USER_SELECT }, payments: true },
  });
  res.json(withPublicUser(loan));
});

app.post('/api/loans/:id/payment', async (req, res) => {
  const { id } = req.params;
  const { amount, principal, interest, balance, paidOn } = req.body;
  const payment = await prisma.finLoanPayment.create({
    data: { loanId: id, amount, principal, interest, balance, paidOn: new Date(paidOn) },
  });
  await prisma.finLoan.update({
    where: { id },
    data: { remainingPrincipal: balance },
  });
  res.json(payment);
});

/**
 * Full edit. Every field is optional — only what's sent is changed — so the
 * status-only updates the bot makes keep working unchanged.
 */
app.put('/api/loans/:id', async (req, res) => {
  const { id } = req.params;
  const {
    name, lender, principal, interestRate, tenureMonths, monthlyEmi,
    disbursedOn, endDate, status, remainingPrincipal, accountId, userId,
  } = req.body ?? {};

  const loan = await prisma.finLoan.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(lender !== undefined ? { lender: lender || null } : {}),
      ...(principal !== undefined ? { principal } : {}),
      ...(interestRate !== undefined ? { interestRate } : {}),
      ...(tenureMonths !== undefined ? { tenureMonths } : {}),
      ...(monthlyEmi !== undefined ? { monthlyEmi } : {}),
      ...(disbursedOn !== undefined ? { disbursedOn: new Date(disbursedOn) } : {}),
      ...(endDate !== undefined ? { endDate: endDate ? new Date(endDate) : null } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(remainingPrincipal !== undefined ? { remainingPrincipal } : {}),
      ...(accountId !== undefined ? { accountId: accountId || null } : {}),
      ...(userId !== undefined ? { userId: userId || null } : {}),
    },
    include: { user: { select: EMBEDDED_USER_SELECT }, payments: { orderBy: { paidOn: 'desc' } } },
  });
  res.json(withPublicUser(loan));
});

/** Deletes the loan; its payments go with it (cascade). */
app.delete('/api/loans/:id', async (req, res) => {
  const { id } = req.params;
  await prisma.finLoan.delete({ where: { id } });
  res.json({ success: true });
});

/**
 * Remove a mis-entered payment.
 *
 * A payment's `balance` field is the outstanding amount *after* it, so it only
 * means anything while that payment exists. Deleting one therefore restores the
 * loan to the newest payment that remains — or to the original principal if
 * none are left. Anything cleverer would have to re-amortise the whole loan.
 */
app.delete('/api/loans/:id/payments/:paymentId', async (req, res) => {
  const { id, paymentId } = req.params;

  const payment = await prisma.finLoanPayment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.loanId !== id) {
    return res.status(404).json({ error: 'Payment not found on this loan' });
  }

  await prisma.finLoanPayment.delete({ where: { id: paymentId } });

  const [loan, latest] = await Promise.all([
    prisma.finLoan.findUnique({ where: { id } }),
    prisma.finLoanPayment.findFirst({ where: { loanId: id }, orderBy: { paidOn: 'desc' } }),
  ]);

  const updated = await prisma.finLoan.update({
    where: { id },
    data: { remainingPrincipal: latest ? latest.balance : (loan?.principal ?? 0) },
    include: { user: { select: EMBEDDED_USER_SELECT }, payments: { orderBy: { paidOn: 'desc' } } },
  });
  res.json(withPublicUser(updated));
});

// ─── Dashboard Summary ─────────────────────────────────────

app.get('/api/dashboard', async (_req, res) => {
  const [accounts, transactions, investments, loans] = await Promise.all([
    prisma.finAccount.findMany({ where: { archived: false } }),
    prisma.finTransaction.findMany({
      take: 50,
      orderBy: { date: 'desc' },
      include: { account: true, category: true, user: { select: EMBEDDED_USER_SELECT } },
    }),
    prisma.finInvestment.findMany(),
    prisma.finLoan.findMany({ where: { status: 'ACTIVE' } }),
  ]);

  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const totalInvested = investments.reduce((sum, i) => sum + i.avgBuyPrice * i.quantity, 0);
  const totalInvestmentValue = investments.reduce((sum, i) => sum + i.currentPrice * i.quantity, 0);
  const totalLoanDebt = loans.reduce((sum, l) => sum + l.remainingPrincipal, 0);
  const netWorth = totalBalance + totalInvestmentValue - totalLoanDebt;

  // "This month" is resolved in IST, not in the server's timezone. Render runs
  // in UTC, so on the 1st of a month before 05:30 IST the two disagree and the
  // dashboard would report the *previous* month's income and expenses.
  // Transaction dates are stored as UTC midnight of the intended calendar day,
  // so getMonth()/getFullYear() on them are already the IST calendar values.
  const [istYear, istMonth] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date())
    .split('-')
    .map(Number);

  const monthTransactions = transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() + 1 === istMonth && d.getFullYear() === istYear;
  });
  const monthlyIncome = monthTransactions
    .filter(t => t.type === 'INCOME').reduce((s, t) => s + t.amount, 0);
  const monthlyExpenses = monthTransactions
    .filter(t => t.type === 'EXPENSE').reduce((s, t) => s + t.amount, 0);

  res.json({
    totalBalance,
    totalInvested,
    totalInvestmentValue,
    investmentPnl: totalInvestmentValue - totalInvested,
    totalLoanDebt,
    netWorth,
    monthlyIncome,
    monthlyExpenses,
    monthlySavings: monthlyIncome - monthlyExpenses,
    recentTransactions: monthTransactions.slice(0, 10).map(withPublicUser),
    accountCount: accounts.length,
    activeLoans: loans.length,
  });
});

// ─── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`ink-finance API server running on http://localhost:${PORT}`);
});
