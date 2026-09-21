import type {
  FinAccount,
  FinCategory,
  FinUser,
  FinLoan,
  FinLoanPayment,
  CreateTransactionPayload,
  CreateLoanPayload,
  TransactionQuery,
  TransactionRow,
} from './types';

/**
 * Thin wrapper around the ink-finance REST API (port 3456).
 * Uses native fetch (Node 18+).
 *
 * The API requires authentication. A bot has no browser and no session
 * cookie, so it authenticates server-to-server with the shared
 * SERVICE_TOKEN secret instead.
 */
export class FinanceApiClient {
  constructor(private baseUrl: string) {}

  /** Headers every request needs, including the service credential. */
  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const serviceToken = process.env.SERVICE_TOKEN;
    return {
      ...(serviceToken ? { 'X-Service-Token': serviceToken } : {}),
      ...extra,
    };
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
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

  /**
   * List transactions. Everything is optional; the API filters server-side so
   * a range query doesn't have to pull the whole history down.
   */
  async getTransactions(query: TransactionQuery = {}): Promise<TransactionRow[]> {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
    }
    const suffix = qs.toString() ? `?${qs}` : '';
    return this.getJson<TransactionRow[]>(`/api/transactions${suffix}`);
  }

  async createTransaction(
    payload: CreateTransactionPayload,
  ): Promise<Record<string, unknown>> {
    return this.postJson('/api/transactions', payload);
  }

  // ── Users ───────────────────────────────────────────────

  async getUsers(): Promise<FinUser[]> {
    return this.getJson<FinUser[]>('/api/users');
  }

  // ── Loans ───────────────────────────────────────────────

  async getLoans(): Promise<FinLoan[]> {
    return this.getJson<FinLoan[]>('/api/loans');
  }

  async createLoan(payload: CreateLoanPayload): Promise<FinLoan> {
    return this.postJson<FinLoan>('/api/loans', payload);
  }

  /** Record an EMI payment against a loan. */
  async createLoanPayment(
    loanId: string,
    payload: { amount: number; principal: number; interest: number; balance: number; paidOn: string },
  ): Promise<FinLoanPayment> {
    return this.postJson<FinLoanPayment>(`/api/loans/${loanId}/payment`, payload);
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
