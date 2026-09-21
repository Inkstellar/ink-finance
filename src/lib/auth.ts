/**
 * Auth helpers for the SPA.
 *
 * Auth.js owns the session; we just talk to its endpoints. Sign-in is a POST
 * of the credentials to the callback endpoint with the CSRF token and
 * `redirect: false`, which makes Auth.js answer with JSON instead of a
 * redirect — the right shape for a single-page app.
 *
 * Everything here is same-origin (`/api/auth/...`), which is what keeps the
 * session cookie first-party. See vite.config.ts for the local proxy and the
 * static-site rewrite for production.
 */
const AUTH_BASE = '/api/auth';

export interface SessionUser {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  initials?: string | null;
}
export interface Session {
  user?: SessionUser;
  expires?: string;
}

async function csrfToken(): Promise<string> {
  const res = await fetch(`${AUTH_BASE}/csrf`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Could not fetch CSRF token (${res.status})`);
  const data = (await res.json()) as { csrfToken?: string };
  if (!data.csrfToken) throw new Error('CSRF token missing from response');
  return data.csrfToken;
}

/** Current session, or null when signed out. */
export async function fetchSession(): Promise<Session | null> {
  const res = await fetch(`${AUTH_BASE}/session`, { credentials: 'include' });
  if (!res.ok) return null;
  const data = (await res.json()) as Session;
  return data?.user ? data : null;
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = await csrfToken();

  const res = await fetch(`${AUTH_BASE}/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Without this, Auth.js answers 302 and the browser swallows the
      // Set-Cookie on the redirect hop. With it, Auth.js replies
      // `200 {"url": ...}` and the session cookie is set on this response.
      'X-Auth-Return-Redirect': '1',
    },
    credentials: 'include',
    body: new URLSearchParams({
      email,
      password,
      csrfToken: token,
      callbackUrl: window.location.origin,
      redirect: 'false',
    }),
  });

  if (!res.ok) return { ok: false, error: `Sign-in failed (${res.status})` };

  // With redirect:false Auth.js replies { url }, carrying ?error=... on failure.
  const data = (await res.json().catch(() => ({}))) as { url?: string };
  const error = data.url ? new URL(data.url, window.location.origin).searchParams.get('error') : null;
  if (error) {
    return {
      ok: false,
      error:
        error === 'CredentialsSignin'
          ? 'Wrong email or password.'
          : `Sign-in failed: ${error}`,
    };
  }

  // Confirm a session really exists rather than trusting the redirect.
  const session = await fetchSession();
  if (!session) return { ok: false, error: 'Sign-in did not create a session.' };
  return { ok: true };
}

export async function signOut(): Promise<void> {
  try {
    const token = await csrfToken();
    await fetch(`${AUTH_BASE}/signout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Auth-Return-Redirect': '1',
      },
      credentials: 'include',
      body: new URLSearchParams({ csrfToken: token, callbackUrl: window.location.origin, redirect: 'false' }),
    });
  } finally {
    // Hard reload: clears every in-memory cache of protected data.
    window.location.href = '/';
  }
}
