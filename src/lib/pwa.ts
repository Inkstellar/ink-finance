/**
 * PWA plumbing: service-worker registration and the "install this app" state.
 *
 * Deliberately free of import-time side effects, so Node can import this file
 * directly in a test (Node 22 strips the type annotations — see
 * scripts/pwa.test.mjs). Anything that touches `window` lives inside a
 * function that the app calls, never at module scope.
 */

export const SW_URL = '/sw.js';

/**
 * Not in TypeScript's DOM lib, so it is declared here.
 * https://developer.mozilla.org/docs/Web/API/BeforeInstallPromptEvent
 */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type InstallOffer = 'none' | 'prompt' | 'ios-instructions';

export interface InstallState {
  /** Already running from the home screen. */
  standalone: boolean;
  /** A `beforeinstallprompt` event is being held, ready to show. */
  prompt: boolean;
  /** iOS or iPadOS Safari, where that event never fires. */
  ios: boolean;
}

/**
 * What (if anything) the UI should offer.
 *
 * Order matters: if a browser both defers a prompt and looks like iOS, the
 * native prompt is the better experience. iOS is the fallback because it has
 * no programmatic install at all — the user has to use the share sheet.
 */
export function installOffer(state: InstallState): InstallOffer {
  if (state.standalone) return 'none';
  if (state.prompt) return 'prompt';
  if (state.ios) return 'ios-instructions';
  return 'none';
}

/**
 * True only for Safari on iOS/iPadOS.
 *
 * Every browser on iOS is WebKit, but only Safari can add a page to the home
 * screen, so Chrome/Firefox/Edge on iOS must not be told to look for a share
 * button that will not work.
 *
 * iPadOS 13+ reports itself as `Macintosh`; the giveaway is a touch-capable
 * "Mac", which no real Mac reports.
 */
export function isIosSafari(userAgent: string, maxTouchPoints = 0): boolean {
  const ios = /iPhone|iPad|iPod/.test(userAgent);
  const iPadOs = /Macintosh/.test(userAgent) && maxTouchPoints > 1;
  if (!ios && !iPadOs) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(userAgent);
}

/** Standalone = launched from the home screen rather than a browser tab. */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const modes = ['standalone', 'fullscreen'];
  const byMediaQuery = modes.some(
    (mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches === true,
  );
  // iOS did not implement the media query until 16.4; `navigator.standalone`
  // is the reliable signal there.
  const byNavigator =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return byMediaQuery || byNavigator;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let justInstalled = false;
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((listener) => listener());
}

/** Subscribe to install-state changes. Returns an unsubscribe function. */
export function subscribeInstall(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function installState(): InstallState {
  if (typeof window === 'undefined') {
    return { standalone: false, prompt: false, ios: false };
  }
  return {
    // `justInstalled` covers the gap between installing and the next launch,
    // where the display-mode media query has not switched over yet.
    standalone: justInstalled || isStandaloneDisplay(),
    prompt: deferredPrompt !== null,
    ios: isIosSafari(window.navigator.userAgent, window.navigator.maxTouchPoints ?? 0),
  };
}

/**
 * Show the browser's install dialog. A deferred event is single-use, so it is
 * cleared before prompting — a second call correctly reports `unavailable`.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferredPrompt;
  if (!event) return 'unavailable';
  deferredPrompt = null;
  notify();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}

export interface InitOptions {
  /**
   * Register the service worker. The app passes `import.meta.env.PROD` — a dev
   * server that caches its own module graph is a debugging trap, and the SW
   * must never be the reason a local edit appears not to take effect.
   */
  serviceWorker?: boolean;
}

let started = false;

/** Wires the global install/service-worker listeners. Safe to call twice. */
export function initPwa({ serviceWorker = false }: InitOptions = {}): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    // Without preventDefault Chrome shows its own mini-infobar, and the event
    // cannot be replayed later from our own button.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    justInstalled = true;
    notify();
  });

  if (serviceWorker) registerServiceWorker();
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  // A worker that takes over while an older bundle is running would serve the
  // new cache to old code. Reloading once on `controllerchange` keeps the page
  // and the worker from the same deploy — but only if a worker was already in
  // control, so the very first install does not reload for no reason.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(SW_URL).catch((error) => {
      // Never fatal: the app works fine without offline support.
      console.warn('[pwa] service worker registration failed', error);
    });
  });
}
