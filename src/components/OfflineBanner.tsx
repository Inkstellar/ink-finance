import { useEffect, useState } from 'react';
import { Alert } from '@mui/material';
import CloudOffIcon from '@mui/icons-material/CloudOff';

/**
 * Shown when the browser reports no connection.
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

  if (online) return null;

  return (
    <Alert severity="warning" icon={<CloudOffIcon />} square sx={{ borderRadius: 0 }}>
      You are offline. Anything shown may be out of date and entries cannot be saved.
    </Alert>
  );
}
