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

export interface PendingTransaction {
  id: string;
  telegramUserId: number;
  chatId: number;
  messageText: string;
  analysis: ReceiptAnalysis;
  categoryId?: string;
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
}
