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

  private async postJson<T>(
    path: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json', ...extraHeaders }),
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

  /**
   * Create a transaction.
   *
   * `actor` names whoever typed it in. The API sends the other users a Telegram
   * alert and has to know who to leave out — being told about your own entry is
   * noise. The bot has no session, so it passes the actor as headers; the API
   * honours them only from a caller holding the service token.
   */
  async createTransaction(
    payload: CreateTransactionPayload,
    actor?: { userId?: string | null; telegramId?: string | number | null },
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {};
    if (actor?.userId) headers['X-Actor-User-Id'] = actor.userId;
    if (actor?.telegramId != null) headers['X-Actor-Telegram-Id'] = String(actor.telegramId);
    return this.postJson('/api/transactions', payload, headers);
  }

  // ── Users ───────────────────────────────────────────────

  async getUsers(): Promise<FinUser[]> {
    return this.getJson<FinUser[]>('/api/users');
  }

  /** Partial update — omitted fields are left alone. */
  async updateUser(
    id: string,
    data: { name?: string; initials?: string; color?: string; telegramId?: string | null; email?: string | null },
  ): Promise<FinUser> {
    const res = await fetch(`${this.baseUrl}/api/users/${id}`, {
      method: 'PUT',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json() as Promise<FinUser>;
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
