import type {
  FinAccount,
  FinCategory,
  CreateTransactionPayload,
} from './types.js';

/**
 * Thin wrapper around the ink-finance REST API (port 3456).
 * Uses native fetch (Node 18+).
 */
export class FinanceApiClient {
  constructor(private baseUrl: string) {}

  private async getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  // ── Accounts ──────────────────────────────────────────────

  async getAccounts(): Promise<FinAccount[]> {
    return this.getJson<FinAccount[]>('/api/accounts');
  }

  async createAccount(data: {
    name: string;
    type: string;
    balance?: number;
  }): Promise<FinAccount> {
    return this.postJson<FinAccount>('/api/accounts', data);
  }

  // ── Categories ────────────────────────────────────────────

  async getCategories(): Promise<FinCategory[]> {
    return this.getJson<FinCategory[]>('/api/categories');
  }

  async createCategory(data: {
    name: string;
    type: string;
    color?: string;
    icon?: string;
  }): Promise<FinCategory> {
    return this.postJson<FinCategory>('/api/categories', data);
  }

  // ── Transactions ──────────────────────────────────────────

  async createTransaction(
    payload: CreateTransactionPayload,
  ): Promise<Record<string, unknown>> {
    return this.postJson('/api/transactions', payload);
  }

  // ── Dashboard ─────────────────────────────────────────────

  async getDashboard(): Promise<{
    totalBalance: number;
    netWorth: number;
    monthlyIncome: number;
    monthlyExpenses: number;
    monthlySavings: number;
    accountCount: number;
  }> {
    return this.getJson('/api/dashboard');
  }
}
