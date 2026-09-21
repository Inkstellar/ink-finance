/**
 * Same-origin API client.
 *
 * Paths already include the `/api` prefix (e.g. `/api/transactions`), so there
 * is deliberately no base URL here: calling the origin that served the page is
 * what keeps the Auth.js session cookie first-party. Locally Vite proxies
 * `/api` to the API server; in production a static-site rewrite does the same.
 * See vite.config.ts and DEPLOY_RENDER.md.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Tells the app shell the session is gone, so it can show the login screen. */
function notifyUnauthorized() {
  window.dispatchEvent(new Event('auth:unauthorized'));
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });

  if (res.status === 401) {
    notifyUnauthorized();
    throw new ApiError(401, 'Session expired — please sign in again.');
  }
  if (!res.ok) {
    throw new ApiError(res.status, `API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}
