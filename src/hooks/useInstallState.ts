import { useEffect, useState } from 'react';
import { installState, subscribeInstall, type InstallState } from '../lib/pwa';

/**
 * Current install state, re-read whenever the browser tells us something
 * changed (an install prompt becoming available, or the app being installed).
 */
export function useInstallState(): InstallState {
  const [state, setState] = useState<InstallState>(installState);

  useEffect(() => subscribeInstall(() => setState(installState())), []);

  return state;
}
