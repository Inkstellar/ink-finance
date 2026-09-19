-- ink-finance: Create tables in the shared Neon PostgreSQL database.
-- Only creates fin_* tables — does NOT touch existing puck project tables.
-- Run with: npx prisma db execute --file prisma/seed.sql

-- CreateEnum
CREATE TYPE "FinAccountType" AS ENUM ('CHECKING', 'SAVINGS', 'CREDIT_CARD', 'CASH', 'WALLET', 'INVESTMENT', 'LOAN');

-- CreateEnum
CREATE TYPE "FinCategoryType" AS ENUM ('INCOME', 'EXPENSE', 'INVESTMENT', 'LOAN_PAYMENT', 'TRANSFER');

-- CreateEnum
CREATE TYPE "FinTransactionType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER', 'INVESTMENT_BUY', 'INVESTMENT_SELL', 'LOAN_PAYMENT');

-- CreateEnum
CREATE TYPE "FinAssetType" AS ENUM ('STOCK', 'MUTUAL_FUND', 'ETF', 'BOND', 'CRYPTO', 'GOLD', 'OTHER');

-- CreateEnum
CREATE TYPE "FinLoanStatus" AS ENUM ('ACTIVE', 'CLOSED', 'PRECLOSED');

-- CreateTable
CREATE TABLE IF NOT EXISTS "fin_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FinAccountType" NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "notes" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fin_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "fin_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FinCategoryType" NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#1976d2',
    "icon" TEXT,
    "parentId" TEXT,
    CONSTRAINT "fin_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "fin_transactions" (
    "id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" "FinTransactionType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "notes" TEXT,
    "accountId" TEXT NOT NULL,
    "categoryId" TEXT,
    "toAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fin_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "fin_budgets" (
    "id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fin_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "fin_investments" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "exchange" TEXT,
    "assetType" "FinAssetType" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "avgBuyPrice" DOUBLE PRECISION NOT NULL,
    "currentPrice" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fin_investments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "fin_loans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lender" TEXT,
    "principal" DOUBLE PRECISION NOT NULL,
    "interestRate" DOUBLE PRECISION NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "monthlyEmi" DOUBLE PRECISION NOT NULL,
    "disbursedOn" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "remainingPrincipal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "FinLoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fin_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "fin_loan_payments" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "principal" DOUBLE PRECISION NOT NULL,
    "interest" DOUBLE PRECISION NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,
    "paidOn" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fin_loan_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "fin_budgets_categoryId_month_year_key" ON "fin_budgets"("categoryId", "month", "year");

-- AddForeignKey (only if they don't already exist)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fin_categories_parentId_fkey') THEN
        ALTER TABLE "fin_categories" ADD CONSTRAINT "fin_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "fin_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fin_transactions_accountId_fkey') THEN
        ALTER TABLE "fin_transactions" ADD CONSTRAINT "fin_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "fin_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fin_transactions_categoryId_fkey') THEN
        ALTER TABLE "fin_transactions" ADD CONSTRAINT "fin_transactions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "fin_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fin_budgets_categoryId_fkey') THEN
        ALTER TABLE "fin_budgets" ADD CONSTRAINT "fin_budgets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "fin_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fin_loans_accountId_fkey') THEN
        ALTER TABLE "fin_loans" ADD CONSTRAINT "fin_loans_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "fin_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fin_loan_payments_loanId_fkey') THEN
        ALTER TABLE "fin_loan_payments" ADD CONSTRAINT "fin_loan_payments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "fin_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
