import { useEffect, useState } from 'react';
import { Alert, Link } from '@mui/material';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

/**
 * Shown when the browser reports no connection or the API is unreachable.
 *
 * The service worker caches the app shell but deliberately never caches /api,
 * so offline the app still opens and then fails to load any numbers. Saying so
 * matters here: a finance screen showing stale balances with no warning is
 * worse than one that admits it is offline.
 */
export default function OfflineBanner() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [apiReachable, setApiReachable] = useState(true);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    async function checkApi() {
      try {
        // Simple ping to the current origin's /api endpoint.
        // We use a head request or just fetch a small resource to check reachability.
        const res = await fetch('/api/health', { method: 'HEAD', cache: 'no-store' });
        setApiReachable(res.ok);
      } catch {
        setApiReachable(false);
      }
    }

    if (online) {
      checkApi();
      // Check every 30 seconds if we are online but API is down
      const interval = setInterval(checkApi, 30000);
      return () => clearInterval(interval);
    }
  }, [online]);

  if (online && apiReachable) return null;

  if (!online) {
    return (
      <Alert severity="warning" icon={<CloudOffIcon />} square sx={{ borderRadius: 0 }}>
        You are offline. Anything shown may be out of date and entries cannot be saved.
      </Alert>
    );
  }

  return (
    <Alert 
      severity="error" 
      icon={<WarningAmberIcon />} 
      square 
      sx={{ borderRadius: 0 }}
    >
      The API server is currently unreachable. 
      <Link 
        href="https://Ink-finance-api.onrender.com" 
        target="_blank" 
        rel="noopener noreferrer"
        sx={{ ml: 1, fontWeight: 'bold' }}
      >
        Open API server to wake it up
      </Link>
    </Alert>
  );
}
