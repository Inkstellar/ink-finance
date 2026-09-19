import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();
const PORT = parseInt(process.env.API_PORT || '3456', 10);

app.use(cors());
app.use(express.json());

// ─── Health ─────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ink-finance' });
});

// ─── Accounts ──────────────────────────────────────────────

app.get('/api/accounts', async (_req, res) => {
  const accounts = await prisma.finAccount.findMany({
    where: { archived: false },
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
  const { accountId, categoryId, type, limit, offset } = req.query;
  const transactions = await prisma.finTransaction.findMany({
    where: {
      ...(accountId && { accountId: String(accountId) }),
      ...(categoryId && { categoryId: String(categoryId) }),
      ...(type && { type: String(type) }),
    },
    include: { account: true, category: true },
    orderBy: { date: 'desc' },
    ...(limit && { take: parseInt(String(limit)) }),
    ...(offset && { skip: parseInt(String(offset)) }),
  });
  res.json(transactions);
});

app.post('/api/transactions', async (req, res) => {
  const { amount, type, date, description, notes, accountId, categoryId, toAccountId } = req.body;
  const tx = await prisma.finTransaction.create({
    data: {
      amount,
      type,
      date: new Date(date),
      description,
      notes,
      accountId,
      categoryId,
      toAccountId,
    },
    include: { account: true, category: true },
  });

  // Update account balance
  const balanceChange =
    type === 'INCOME' ? amount :
    type === 'EXPENSE' || type === 'LOAN_PAYMENT' || type === 'INVESTMENT_BUY' ? -amount :
    0; // TRANSFER handled separately
  if (balanceChange !== 0) {
    await prisma.finAccount.update({
      where: { id: accountId },
      data: { balance: { increment: balanceChange } },
    });
  }

  res.json(tx);
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
    include: { payments: { orderBy: { paidOn: 'desc' }, take: 5 } },
    orderBy: { disbursedOn: 'asc' },
  });
  res.json(loans);
});

app.post('/api/loans', async (req, res) => {
  const { name, lender, principal, interestRate, tenureMonths, monthlyEmi, disbursedOn, endDate, accountId } = req.body;
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
    },
    include: { payments: true },
  });
  res.json(loan);
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

app.put('/api/loans/:id', async (req, res) => {
  const { id } = req.params;
  const { status, remainingPrincipal } = req.body;
  const loan = await prisma.finLoan.update({
    where: { id },
    data: { status, remainingPrincipal },
  });
  res.json(loan);
});

// ─── Dashboard Summary ─────────────────────────────────────

app.get('/api/dashboard', async (_req, res) => {
  const [accounts, transactions, investments, loans] = await Promise.all([
    prisma.finAccount.findMany({ where: { archived: false } }),
    prisma.finTransaction.findMany({
      take: 50,
      orderBy: { date: 'desc' },
      include: { account: true, category: true },
    }),
    prisma.finInvestment.findMany(),
    prisma.finLoan.findMany({ where: { status: 'ACTIVE' } }),
  ]);

  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const totalInvested = investments.reduce((sum, i) => sum + i.avgBuyPrice * i.quantity, 0);
  const totalInvestmentValue = investments.reduce((sum, i) => sum + i.currentPrice * i.quantity, 0);
  const totalLoanDebt = loans.reduce((sum, l) => sum + l.remainingPrincipal, 0);
  const netWorth = totalBalance + totalInvestmentValue - totalLoanDebt;

  const now = new Date();
  const monthTransactions = transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
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
    recentTransactions: monthTransactions.slice(0, 10),
    accountCount: accounts.length,
    activeLoans: loans.length,
  });
});

// ─── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`ink-finance API server running on http://localhost:${PORT}`);
});
