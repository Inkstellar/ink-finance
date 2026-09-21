// Shared types for the Telegram bot service

import type { TxType } from './analytics';

export interface FinAccount {
  id: string;
  name: string;
  type: string;
  balance: number;
  currency: string;
  notes: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FinCategory {
  id: string;
  name: string;
  type: string;
  color: string;
  icon: string | null;
  parentId: string | null;
  parent: FinCategory | null;
}

export interface ReceiptAnalysis {
  merchant: string;
  amount: number;
  date: string;        // YYYY-MM-DD
  category: string;
  // The receipt flow only ever produces EXPENSE or INCOME, but a typed template
  // ("transfer …", "sell …") reuses this shape, so it carries the full union.
  type: TxType;
  paymentMethod?: string;
  rawText?: string;
  confidence: number;  // 0-1
}

export interface FinUser {
  id: string;
  name: string;
  initials: string;
  color: string;
  telegramId?: string | null;
}

export interface PendingTransaction {
  id: string;
  telegramUserId: number;
  chatId: number;
  messageText: string;
  analysis: ReceiptAnalysis;
  categoryId?: string;
  userId?: string | null;
  createdAt: number;
  /** Source account, kept while a transfer waits for its destination. */
  accountId?: string;
  /** Set for a LOAN_PAYMENT confirmed from a template, so the loan follows. */
  loanId?: string;
}

// ── Loans ──────────────────────────────────────────────────

export interface FinLoanPayment {
  id: string;
  amount: number;
  principal: number;
  interest: number;
  balance: number;
  paidOn: string;
}

export interface FinLoan {
  id: string;
  name: string;
  lender?: string | null;
  principal: number;
  interestRate: number;
  tenureMonths: number;
  monthlyEmi: number;
  disbursedOn: string;
  endDate?: string | null;
  remainingPrincipal: number;
  status: string;
  accountId?: string | null;
  userId?: string | null;
  user?: FinUser | null;
  payments?: FinLoanPayment[];
}

export interface CreateLoanPayload {
  name: string;
  lender?: string;
  principal: number;
  interestRate: number;
  tenureMonths: number;
  monthlyEmi: number;
  disbursedOn: string;   // YYYY-MM-DD
  userId?: string | null;
}

/**
 * A loan mid-way through the multi-step creation flow.
 * Populated from the `loan <amount> -> <type> -> <owner>` template,
 * then filled in one step at a time (tenure → rate → confirm).
 */
export interface PendingLoan {
  id: string;
  telegramUserId: number;
  chatId: number;
  principal: number;
  typeKey: string;
  typeLabel: string;
  loanName: string;
  ownerId?: string | null;
  ownerName: string;
  lender?: string;
  disbursedOn: string;   // YYYY-MM-DD
  tenureMonths?: number;
  interestRate?: number;
  monthlyEmi?: number;
  createdAt: number;
}

export interface CreateTransactionPayload {
  amount: number;
  type: string;        // 'EXPENSE' | 'INCOME' | etc.
  date: string;        // ISO date string
  description: string;
  notes?: string;
  accountId: string;
  categoryId?: string;
  userId?: string | null;
  /** Destination account — required by the API for a TRANSFER. */
  toAccountId?: string;
}

/** Filters for GET /api/transactions. */
export interface TransactionQuery {
  userId?: string;
  type?: string;
  from?: string;   // YYYY-MM-DD, inclusive
  to?: string;     // YYYY-MM-DD, inclusive
  limit?: number;
}

/** A transaction as the API returns it, with its relations expanded. */
export interface TransactionRow {
  id: string;
  amount: number;
  type: string;
  date: string;
  description: string;
  notes?: string | null;
  accountId: string;
  categoryId?: string | null;
  userId?: string | null;
  toAccountId?: string | null;
  account?: { id: string; name: string } | null;
  category?: { id: string; name: string } | null;
  user?: FinUser | null;
}
