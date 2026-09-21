import { useCallback, useEffect, useState } from 'react';
import { fetchSession, type Session } from '../lib/auth';

/**
 * Session state for the SPA.
 *
 * Re-checks whenever any API call reports 401 (`auth:unauthorized`), so an
 * expired or revoked session drops the user back to the login screen instead
 * of leaving a broken shell of the app on screen.
 */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      setSession(await fetchSession());
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    const onUnauthorized = () => setSession(null);
    window.addEventListener('auth:unauthorized', onUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized);
  }, []);

  return { session, loading, refetch };
}
