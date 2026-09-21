/**
 * PWA checks: the manifest, the icon files, the tags in index.html, the pure
 * install-state helpers, and — the reason this file exists — the real
 * public/sw.js driven through a sandboxed Cache/fetch harness.
 *
 *   npm run test:pwa
 *
 * The service worker sits in front of a finance app, so "never cache /api" is a
 * correctness requirement rather than a performance preference. These checks
 * run against the shipped file, not against a copy of the rules, so the two
 * cannot drift apart.
 *
 * What is *not* tested here: whether a real browser installs the app. That is
 * a browser question, and it was checked by hand in Chrome (manifest parsed,
 * worker activated, offline shell served).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { inflateSync } from 'node:zlib';

import {
  MANIFEST_ICONS,
  PNG_TARGETS,
  VARIANTS,
  glyphCornerRadius,
  glyphPoint,
  renderPng,
} from './icon-art.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicPath = (name) => join(root, 'public', name);
const ORIGIN = 'https://ink.test';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};
const section = (title) => console.log(`\n  ${title}\n`);

// ── A minimal PNG reader, for asserting what the icons actually contain ────
// Written against our own encoder (8-bit RGBA, filter 0 on every row), which
// is enough to prove the committed files are real, the right size, and not
// blank — the failure mode that silently breaks installability.
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error('expected 8-bit RGBA');
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter !== 0) throw new Error(`unexpected PNG filter ${filter} on row ${y}`);
    raw.copy(pixels, y * stride, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  }
  return { width, height, pixels };
}

const pixel = (img, x, y) => {
  const i = (y * img.width + x) * 4;
  return [img.pixels[i], img.pixels[i + 1], img.pixels[i + 2], img.pixels[i + 3]];
};

// ── The service-worker harness ─────────────────────────────────────────────
/**
 * Loads public/sw.js into a fresh VM context with a fake CacheStorage, a
 * controllable fetch, and a fake Request.
 *
 * Request is faked rather than using Node's: a browser resolves a relative URL
 * in a worker against the worker's own origin, and Node has no base URL, so
 * `new Request('/index.html')` throws there. The fake carries exactly the four
 * properties the worker reads (url, method, mode, cache).
 */
function loadServiceWorker({ failFor = [], fetchImpl } = {}) {
  const source = readFileSync(publicPath('sw.js'), 'utf8');
  const version = /const VERSION = '([^']+)'/.exec(source)?.[1];
  if (!version) throw new Error('could not read VERSION out of public/sw.js');

  class FakeRequest {
    constructor(url, init = {}) {
      this.url = new URL(url, ORIGIN).href;
      this.method = init.method ?? 'GET';
      this.mode = init.mode ?? 'no-cors';
      this.cache = init.cache ?? 'default';
    }
  }

  const listeners = new Map();
  const stores = new Map();
  const stats = { skipWaiting: 0, claim: 0, deleted: [], requests: [] };
  const key = (req) => (typeof req === 'string' ? new URL(req, ORIGIN).href : req.url);

  const defaultFetch = async (req) => {
    const url = key(req);
    stats.requests.push(url);
    if (failFor.some((fragment) => url.includes(fragment))) throw new Error(`offline: ${url}`);
    return new Response(`body:${url}`, { status: 200 });
  };
  const doFetch = fetchImpl ?? defaultFetch;

  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async add(req) {
          const response = await doFetch(req);
          if (!response.ok) throw new Error(`add failed for ${key(req)}`);
          store.set(key(req), response);
        },
        async put(req, response) {
          store.set(key(req), response);
        },
        async match(req) {
          return store.get(key(req));
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      stats.deleted.push(name);
      return stores.delete(name);
    },
  };

  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, handler) => listeners.set(type, handler),
    skipWaiting: () => {
      stats.skipWaiting++;
    },
    clients: {
      claim: async () => {
        stats.claim++;
      },
    },
  };

  runInNewContext(source, { self, caches, fetch: doFetch, Request: FakeRequest, Response, URL, console });

  const fire = async (type, event) => {
    const waits = [];
    listeners.get(type)({ ...event, waitUntil: (promise) => waits.push(promise) });
    return waits;
  };

  return {
    version,
    stats,
    caches,
    stores,
    cacheKeys: (name) => [...(stores.get(name)?.keys() ?? [])],

    async install() {
      await Promise.all(await fire('install', {}));
    },

    async activate() {
      await Promise.all(await fire('activate', {}));
    },

    /** Dispatch a fetch. `handled` is false when the worker let it through. */
    async fetch(url, { mode = 'no-cors', method = 'GET' } = {}) {
      let responded = null;
      const waits = await fire('fetch', {
        request: new FakeRequest(url, { mode, method }),
        respondWith: (promise) => {
          responded = promise;
        },
      });
      const response = responded ? await responded : null;
      const scheduled = waits.length;
      await Promise.all(waits); // let background refreshes settle
      return { response, handled: responded !== null, scheduled };
    },

    async message(data) {
      let reply = null;
      await fire('message', {
        data,
        source: { postMessage: (message) => (reply = message) },
      });
      return reply;
    },
  };
}

/** A cross-origin, no-cors response, which is what Google Fonts actually returns. */
const opaqueResponse = () => ({
  ok: false,
  type: 'opaque',
  clone() {
    return this;
  },
});

// ── 1. The manifest ────────────────────────────────────────────────────────
section('manifest');

const manifestRaw = readFileSync(publicPath('manifest.webmanifest'), 'utf8');
let manifest = null;
try {
  manifest = JSON.parse(manifestRaw);
} catch (error) {
  check('manifest.webmanifest is valid JSON', false, error.message);
}

if (manifest) {
  check('manifest.webmanifest is valid JSON', true);
  check('name and short_name are set', Boolean(manifest.name && manifest.short_name));
  check('display is standalone (otherwise it opens in a browser tab)',
    manifest.display === 'standalone', manifest.display);
  check('start_url is the app root', manifest.start_url === '/', manifest.start_url);
  check('scope is the app root (so /transactions stays in-app)', manifest.scope === '/', manifest.scope);
  check('theme_color is a hex colour', /^#[0-9a-f]{6}$/i.test(manifest.theme_color ?? ''),
    manifest.theme_color);
  check('background_color is a hex colour', /^#[0-9a-f]{6}$/i.test(manifest.background_color ?? ''),
    manifest.background_color);
  check('theme_color matches the MUI primary in src/theme.ts',
    manifest.theme_color === '#1a237e', manifest.theme_color);

  const icons = manifest.icons ?? [];
  const sizes = icons.map((icon) => icon.sizes);
  check('declares a 192x192 icon (Chrome requires one)', sizes.includes('192x192'));
  check('declares a 512x512 icon (Chrome requires one)', sizes.includes('512x512'));
  check('declares a maskable icon (Android otherwise shrinks it in a white square)',
    icons.some((icon) => (icon.purpose ?? '').includes('maskable')));
  check('every icon has an absolute src', icons.every((icon) => icon.src?.startsWith('/')));
  check('every icon is typed image/png', icons.every((icon) => icon.type === 'image/png'));

  // The manifest and PNG_TARGETS must agree in both directions, so neither an
  // unused icon file nor a referenced-but-missing one can slip through.
  const declared = icons.map((icon) => icon.src.replace(/^\//, '')).sort();
  const expected = MANIFEST_ICONS.map(([name]) => name).sort();
  check('the manifest lists exactly the generated icon files',
    JSON.stringify(declared) === JSON.stringify(expected),
    `manifest [${declared}] vs generated [${expected}]`);

  check('every icon file exists', declared.every((name) => existsSync(publicPath(name))));

  check('shortcuts point at real routes',
    (manifest.shortcuts ?? []).every((shortcut) => shortcut.url?.startsWith('/')));
  check('apple-touch-icon.png is NOT in the manifest (iOS finds it by convention)',
    !declared.includes('apple-touch-icon.png'));
}

// ── 2. The icons ───────────────────────────────────────────────────────────
section('icons');

for (const [name, size, variant] of PNG_TARGETS) {
  const path = publicPath(name);
  if (!existsSync(path)) {
    check(`${name} exists`, false);
    continue;
  }
  const committed = readFileSync(path);
  let image;
  try {
    image = decodePng(committed);
  } catch (error) {
    check(`${name} decodes as 8-bit RGBA PNG`, false, error.message);
    continue;
  }

  check(`${name} is ${size}x${size}`, image.width === size && image.height === size,
    `${image.width}x${image.height}`);

  // Drift check: the committed file must still be what the art produces.
  const generated = decodePng(renderPng(size, variant));
  check(`${name} matches scripts/icon-art.mjs (run \`npm run icons\` if this fails)`,
    image.pixels.equals(generated.pixels));

  // Sampled from the glyph's own design box rather than guessed: the exact
  // centre of the canvas is the gap between the two middle columns.
  const [gx, gy] = glyphPoint(size, variant, 50, 30.5); // the architrave
  const glyph = pixel(image, gx, gy);
  check(`${name} has the white glyph`, glyph[0] > 240 && glyph[1] > 240 && glyph[2] > 240,
    `rgba(${glyph}) at ${gx},${gy}`);

  const corner = pixel(image, 1, 1);
  if (VARIANTS[variant].radius > 0) {
    check(`${name} has transparent rounded corners`, corner[3] === 0, `alpha ${corner[3]}`);
  } else {
    check(`${name} is fully opaque to the edge (masking is the platform's job)`,
      corner[3] === 255, `alpha ${corner[3]}`);
  }

  const mid = Math.floor(size / 2);
  const offCentre = pixel(image, Math.floor(size * 0.08), mid);
  check(`${name} carries the brand gradient, not a flat colour`,
    offCentre[0] !== offCentre[1] || offCentre[1] !== offCentre[2],
    `rgb(${offCentre.slice(0, 3)})`);
}

check('the maskable glyph fits inside Android\'s 80% crop circle',
  glyphCornerRadius('maskable') <= 0.4, glyphCornerRadius('maskable').toFixed(3));
check('the "any" glyph deliberately does not (it is not cropped)',
  glyphCornerRadius('any') > 0.4, glyphCornerRadius('any').toFixed(3));

const svg = readFileSync(publicPath('icon.svg'), 'utf8');
check('icon.svg is an SVG', svg.trimStart().startsWith('<svg'));
check('icon.svg has a viewBox', /viewBox="0 0 512 512"/.test(svg));
check('icon.svg uses the same gradient stops as the PNGs',
  svg.includes('#667eea') && svg.includes('#764ba2'));

// ── 3. index.html ──────────────────────────────────────────────────────────
section('index.html');

const html = readFileSync(join(root, 'index.html'), 'utf8');
const meta = (name) =>
  new RegExp(`<meta[^>]+name="${name}"[^>]+content="([^"]+)"`).exec(html)?.[1];

check('links the manifest', /<link[^>]+rel="manifest"[^>]+href="\/manifest\.webmanifest"/.test(html));
check('declares theme-color', /<meta[^>]+name="theme-color"[^>]+content="#[0-9a-f]{6}"/i.test(html));
check('declares apple-touch-icon', /<link[^>]+rel="apple-touch-icon"[^>]+href="\/apple-touch-icon\.png"/.test(html));
check('declares apple-mobile-web-app-capable (the flag iOS actually reads)',
  meta('apple-mobile-web-app-capable') === 'yes');
check('declares a non-translucent iOS status bar style (dark text stays legible)',
  meta('apple-mobile-web-app-status-bar-style') === 'default');
check('declares the home-screen title', meta('apple-mobile-web-app-title') === 'Ink Finance');
check('no longer references the missing /vite.svg', !html.includes('/vite.svg'));

// Every local asset the head points at must actually exist in public/ — this is
// the bug that was already here once (/vite.svg pointed at nothing).
const localRefs = [...html.matchAll(/(?:href|src)="(\/[^"]+)"/g)]
  .map((match) => match[1])
  .filter((href) => href !== '/src/main.tsx' && !href.startsWith('//'));
const missing = localRefs.filter((href) => !existsSync(publicPath(href.slice(1))));
check('every local asset referenced by index.html exists in public/', missing.length === 0,
  missing.join(', '));

check('main.tsx initialises the PWA',
  readFileSync(join(root, 'src/main.tsx'), 'utf8').includes('initPwa('));
check('the service worker is registered from src/lib/pwa.ts',
  readFileSync(join(root, 'src/lib/pwa.ts'), 'utf8').includes("SW_URL = '/sw.js'"));

// ── 4. The install-state rules ─────────────────────────────────────────────
section('install offer');

const pwa = await import('../src/lib/pwa.ts');

check('an installed app is offered nothing',
  pwa.installOffer({ standalone: true, prompt: false, ios: false }) === 'none');
check('a deferred prompt is used when available',
  pwa.installOffer({ standalone: false, prompt: true, ios: false }) === 'prompt');
check('the native prompt wins over the iOS instructions',
  pwa.installOffer({ standalone: false, prompt: true, ios: true }) === 'prompt');
check('iOS Safari gets instructions',
  pwa.installOffer({ standalone: false, prompt: false, ios: true }) === 'ios-instructions');
check('a desktop browser with no prompt is offered nothing',
  pwa.installOffer({ standalone: false, prompt: false, ios: false }) === 'none');

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_OS =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

check('iPhone Safari is recognised', pwa.isIosSafari(IPHONE));
check('iPadOS reporting itself as a Mac is recognised (touch points give it away)',
  pwa.isIosSafari(IPAD_OS, 5));
check('a real Mac is not (no touch points)', !pwa.isIosSafari(IPAD_OS, 0));
check('Chrome on iOS is not (it cannot add to the home screen)',
  !pwa.isIosSafari(IPHONE.replace('Version/17.5', 'CriOS/129.0')));
check('Android is not', !pwa.isIosSafari(ANDROID));
check('desktop Chrome is not', !pwa.isIosSafari(MAC));

// ── 5. The service worker ──────────────────────────────────────────────────
section('service worker');

{
  const sw = loadServiceWorker();
  check('a version is declared (bumping it is what invalidates the caches)',
    Boolean(sw.version), sw.version);

  // --- /api must never be touched -----------------------------------------
  const apiGet = await sw.fetch(`${ORIGIN}/api/transactions`);
  check('a GET /api request is not intercepted', !apiGet.handled);
  check('  …and never reaches the cache', sw.stats.requests.length === 0);

  const apiPost = await sw.fetch(`${ORIGIN}/api/transactions`, { method: 'POST' });
  check('a POST /api request is not intercepted', !apiPost.handled);

  const otherPost = await sw.fetch(`${ORIGIN}/assets/index-abc.js`, { method: 'POST' });
  check('no write of any kind is intercepted', !otherPost.handled);

  const swSelf = await sw.fetch(`${ORIGIN}/sw.js`);
  check('the worker does not try to serve itself', !swSelf.handled);

  // --- install ------------------------------------------------------------
  await sw.install();
  const shellKeys = sw.cacheKeys(`${sw.version}-shell`);
  check('install precaches the shell',
    shellKeys.includes(`${ORIGIN}/index.html`), shellKeys.join(', '));
  check('install precaches the manifest and icons',
    shellKeys.includes(`${ORIGIN}/manifest.webmanifest`) &&
      shellKeys.includes(`${ORIGIN}/icon-512.png`));
  check('install activates immediately', sw.stats.skipWaiting === 1);

  // --- navigation ---------------------------------------------------------
  const nav = await sw.fetch(`${ORIGIN}/transactions`, { mode: 'navigate' });
  check('a navigation is served from the network', nav.handled && nav.response.status === 200);
  check('a navigation refreshes the cached shell',
    sw.cacheKeys(`${sw.version}-shell`).includes(`${ORIGIN}/index.html`));
  check('a deep link is cached under /index.html, not its own path',
    !sw.cacheKeys(`${sw.version}-shell`).includes(`${ORIGIN}/transactions`));

  // --- the offline shell --------------------------------------------------
  const offline = loadServiceWorker({ failFor: ['/transactions'] });
  await offline.install();
  const offlineNav = await offline.fetch(`${ORIGIN}/transactions`, { mode: 'navigate' });
  const body = await offlineNav.response.text();
  check('offline, a navigation falls back to the cached shell',
    body === `body:${ORIGIN}/index.html`, body);

  const dead = loadServiceWorker({ failFor: ['/'] });
  const empty = await dead.fetch(`${ORIGIN}/loans`, { mode: 'navigate' });
  check('with no cache at all, a navigation returns a network error rather than throwing',
    empty.response?.type === 'error', String(empty.response?.type));

  // --- hashed assets ------------------------------------------------------
  const asset = await sw.fetch(`${ORIGIN}/assets/index-abc123.js`);
  check('a hashed asset is fetched on first use', asset.handled && asset.response.status === 200);
  const beforeAsset = sw.stats.requests.length;
  const assetAgain = await sw.fetch(`${ORIGIN}/assets/index-abc123.js`);
  check('a hashed asset is served from cache the second time',
    (await assetAgain.response.text()).startsWith('body:'));
  check('  …with no network request at all', sw.stats.requests.length === beforeAsset,
    `${sw.stats.requests.length - beforeAsset} extra request(s)`);

  // --- everything else: stale-while-revalidate ----------------------------
  const icon = await sw.fetch(`${ORIGIN}/icon-192.png`);
  check('an icon is fetched on first use', icon.handled && icon.response.status === 200);
  const beforeIcon = sw.stats.requests.length;
  const iconAgain = await sw.fetch(`${ORIGIN}/icon-192.png`);
  check('an icon is served from cache immediately',
    (await iconAgain.response.text()).startsWith('body:'));
  check('  …and refreshed in the background', iconAgain.scheduled === 1);
  check('  …so the network was still consulted', sw.stats.requests.length > beforeIcon);

  // --- cross-origin, opaque (Google Fonts) --------------------------------
  const opaque = loadServiceWorker({ fetchImpl: async () => opaqueResponse() });
  const font = await opaque.fetch('https://fonts.gstatic.com/s/inter/v13/abc.woff2');
  check('a cross-origin font is intercepted', font.handled);
  check('an opaque response is accepted into the cache (status 0 is not a failure)',
    opaque.cacheKeys(`${opaque.version}-static`).length === 1,
    opaque.cacheKeys(`${opaque.version}-static`).join(', '));

  // --- activate -----------------------------------------------------------
  await (await sw.caches.open('ink-finance-v0-shell')).put('/index.html', new Response('old'));
  await (await sw.caches.open(`${sw.version}-shell`)).put('/keep', new Response('keep'));
  await sw.activate();
  check('activate deletes caches from older versions',
    sw.stats.deleted.includes('ink-finance-v0-shell'), sw.stats.deleted.join(', '));
  check('  …and keeps its own',
    sw.cacheKeys(`${sw.version}-shell`).includes(`${ORIGIN}/keep`));
  check('activate claims open pages', sw.stats.claim === 1);

  // --- messaging ----------------------------------------------------------
  const reply = await sw.message({ type: 'ink:version' });
  check('the worker reports its version on request',
    reply?.version === sw.version, JSON.stringify(reply));
  check('an unknown message is ignored', (await sw.message({ type: 'nope' })) === null);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
