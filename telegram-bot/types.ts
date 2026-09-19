// Shared types for the Telegram bot service

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
  type: 'EXPENSE' | 'INCOME';
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
}
