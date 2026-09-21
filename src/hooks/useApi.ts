import { useState, useEffect, useCallback } from 'react';

/**
 * Fetch a JSON endpoint same-origin, with credentials.
 *
 * `path` includes the `/api` prefix (e.g. `/api/transactions`). Calling the
 * origin that served the page keeps the session cookie first-party — see
 * src/lib/api.ts for why that matters.
 */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!path) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(path, { credentials: 'include' });
      if (res.status === 401) {
        // Session gone: let the app shell swap in the login screen.
        window.dispatchEvent(new Event('auth:unauthorized'));
        throw new Error('401');
      }
      if (!res.ok) throw new Error(`${res.status}`);
      setData(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, loading, error, refetch };
}
