/**
 * The Ink Finance app mark — defined once, as geometry.
 *
 * Both the SVG favicon and every PNG the manifest points at are generated from
 * this file by `npm run icons` (scripts/generate-icons.mjs), so the home-screen
 * icon can never drift from the favicon.
 *
 * The mark is the same white ledger glyph the sidebar shows
 * (`@mui/icons-material/AccountBalance`) sitting on the sidebar header's
 * gradient. That is deliberate: the installed icon should look like the app
 * the user already recognises.
 *
 * No image library is involved. Rendering is a 4x4 supersampled scanline
 * rasteriser over a handful of primitives, and the PNG encoder is ~40 lines of
 * `node:zlib`. That keeps the icons reproducible in CI with zero dependencies —
 * which matters, because a blank or wrong-sized icon silently breaks
 * installability and nothing else would catch it.
 */

import { deflateSync } from 'node:zlib';

/** Shared with the sidebar header gradient (src/components/Sidebar.tsx). */
export const GRADIENT = { from: '#667eea', to: '#764ba2' };

/**
 * The glyph, drawn in a 0..100 box (y grows downward).
 *
 *   roof       — the pediment, a triangle
 *   rects      — [x, y, width, height] for the architrave, columns, base, plinth
 */
export const GLYPH = {
  roof: [
    [50, 1],
    [100, 27],
    [0, 27],
  ],
  rects: [
    [5, 27, 90, 7], // architrave, directly under the roof
    [12, 40, 11, 39], // column 1
    [34, 40, 11, 39], // column 2
    [55, 40, 11, 39], // column 3
    [77, 40, 11, 39], // column 4
    [6, 79, 88, 8], // base
    [1, 87, 98, 11], // plinth
  ],
};

/**
 * Three variants, because the platforms disagree about what they want.
 *
 *   radius — corner rounding as a fraction of the canvas. Android/iOS mask the
 *            icon themselves, so only the browser favicon wants rounding.
 *   glyph  — the glyph's side as a fraction of the canvas. Maskable icons are
 *            cropped to a circle of 80% diameter, and a square of side s needs
 *            0.707*s <= 0.4*canvas to survive that — so the maskable glyph is
 *            noticeably smaller on purpose. It is not a bug.
 */
export const VARIANTS = {
  any: { radius: 0.22, glyph: 0.66 },
  maskable: { radius: 0, glyph: 0.52 },
  apple: { radius: 0, glyph: 0.6 },
};

/**
 * The files to write into public/, and the source of truth shared by
 * scripts/generate-icons.mjs (which writes them) and scripts/pwa.test.mjs
 * (which asserts the committed files still match the art, and that the
 * manifest references exactly these).
 *
 * `apple-touch-icon.png` is absent from the manifest on purpose: iOS finds it
 * by convention at that exact path, and it is never listed.
 *
 * [filename, size in px, variant]
 */
export const PNG_TARGETS = [
  ['icon-192.png', 192, 'any'],
  ['icon-512.png', 512, 'any'],
  ['icon-maskable-512.png', 512, 'maskable'],
  ['apple-touch-icon.png', 180, 'apple'],
];

/** Files that should also be declared in the manifest. */
export const MANIFEST_ICONS = PNG_TARGETS.filter(([name]) => name !== 'apple-touch-icon.png');

/**
 * Pixel coordinates of a point given in the glyph's 0..100 design box, for the
 * variant's placement. Exposed so a test can sample "the architrave" instead of
 * guessing at raw pixel coordinates — the exact centre of the canvas is a gap
 * between two columns, which makes it a poor place to look for white.
 */
export function glyphPoint(size, variantName, gx, gy) {
  const variant = VARIANTS[variantName];
  const side = size * variant.glyph;
  const offset = (size - side) / 2;
  return [Math.round(offset + (gx / 100) * side), Math.round(offset + (gy / 100) * side)];
}

/**
 * How far the glyph's corner sits from the centre, as a fraction of the canvas.
 *
 * A maskable icon is cropped to a circle of 40% radius, so this must stay at or
 * under 0.4 — otherwise Android's launcher shaves the corners off the mark.
 */
export function glyphCornerRadius(variantName) {
  return (VARIANTS[variantName].glyph * Math.SQRT2) / 2;
}

const SUPER_SAMPLE = 4;

function hexToRgb(hex) {
  const h = hex.replace(/^#/, '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Rounded-rectangle test: clamp the point into the inner rect, then measure. */
function insideRoundedRect(x, y, size, radius) {
  if (x < 0 || y < 0 || x >= size || y >= size) return false;
  if (radius <= 0) return true;
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function insideTriangle(px, py, [a, b, c]) {
  const sign = (p1, p2, p3) =>
    (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = sign([px, py], a, b);
  const d2 = sign([px, py], b, c);
  const d3 = sign([px, py], c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function insideGlyph(x, y, offset, side) {
  const gx = ((x - offset) / side) * 100;
  const gy = ((y - offset) / side) * 100;
  if (gx < 0 || gy < 0 || gx > 100 || gy > 100) return false;
  for (const [rx, ry, rw, rh] of GLYPH.rects) {
    if (gx >= rx && gx <= rx + rw && gy >= ry && gy <= ry + rh) return true;
  }
  return insideTriangle(gx, gy, GLYPH.roof);
}

/**
 * Rasterise one icon variant to straight-alpha RGBA bytes.
 *
 * Averaging is done in premultiplied space (an uncovered sample contributes
 * nothing to the colour sum) and then divided by the *covered* count, because
 * PNG stores straight alpha. Getting that backwards darkens every edge.
 */
export function renderRgba(size, variantName) {
  const variant = VARIANTS[variantName];
  if (!variant) throw new Error(`unknown icon variant: ${variantName}`);

  const from = hexToRgb(GRADIENT.from);
  const to = hexToRgb(GRADIENT.to);
  const radius = variant.radius * size;
  const glyphSide = size * variant.glyph;
  const glyphOffset = (size - glyphSide) / 2;
  const step = 1 / SUPER_SAMPLE;
  const total = SUPER_SAMPLE * SUPER_SAMPLE;

  const out = new Uint8Array(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let covered = 0;

      for (let sy = 0; sy < SUPER_SAMPLE; sy++) {
        for (let sx = 0; sx < SUPER_SAMPLE; sx++) {
          const x = px + (sx + 0.5) * step;
          const y = py + (sy + 0.5) * step;
          if (!insideRoundedRect(x, y, size, radius)) continue;

          covered++;
          if (insideGlyph(x, y, glyphOffset, glyphSide)) {
            sumR += 255;
            sumG += 255;
            sumB += 255;
          } else {
            const t = (x / size + y / size) / 2; // top-left -> bottom-right
            sumR += from[0] + (to[0] - from[0]) * t;
            sumG += from[1] + (to[1] - from[1]) * t;
            sumB += from[2] + (to[2] - from[2]) * t;
          }
        }
      }

      if (!covered) continue; // leaves the pixel fully transparent
      const i = (py * size + px) * 4;
      out[i] = Math.round(sumR / covered);
      out[i + 1] = Math.round(sumG / covered);
      out[i + 2] = Math.round(sumB / covered);
      out[i + 3] = Math.round((covered * 255) / total);
    }
  }

  return out;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Minimal PNG encoder: 8-bit RGBA, filter 0 on every scanline. */
export function encodePng(rgba, size) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  const pixels = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // bytes 10..12 stay zero: deflate, adaptive filtering, no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function renderPng(size, variantName) {
  return encodePng(renderRgba(size, variantName), size);
}

/** The SVG favicon, generated from the same geometry as the PNGs. */
export function iconSvg(variantName = 'any') {
  const variant = VARIANTS[variantName];
  const size = 512;
  const side = size * variant.glyph;
  const offset = (size - side) / 2;
  const k = side / 100;
  const px = (n) => +(offset + n * k).toFixed(2);
  const len = (n) => +(n * k).toFixed(2);

  const rects = GLYPH.rects
    .map(
      ([x, y, w, h]) =>
        `<rect x="${px(x)}" y="${px(y)}" width="${len(w)}" height="${len(h)}"/>`,
    )
    .join('');
  const [a, b, c] = GLYPH.roof;
  const roof = `<path d="M${px(a[0])} ${px(a[1])}L${px(b[0])} ${px(b[1])}L${px(c[0])} ${px(c[1])}Z"/>`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Ink Finance">`,
    '  <defs>',
    '    <linearGradient id="ink" x1="0" y1="0" x2="1" y2="1">',
    `      <stop offset="0" stop-color="${GRADIENT.from}"/>`,
    `      <stop offset="1" stop-color="${GRADIENT.to}"/>`,
    '    </linearGradient>',
    '  </defs>',
    `  <rect width="${size}" height="${size}" rx="${(variant.radius * size).toFixed(2)}" fill="url(#ink)"/>`,
    `  <g fill="#fff">${roof}${rects}</g>`,
    '</svg>',
    '',
  ].join('\n');
}
