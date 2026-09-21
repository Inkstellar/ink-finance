/**
 * Writes the PWA icon set into public/.
 *
 *   npm run icons
 *
 * Everything here is derived from scripts/icon-art.mjs, so this file is only
 * about writing files. The output is committed — the Render build runs
 * `npm run build` (vite), which copies public/ verbatim, and a static host has
 * no way to generate an icon at request time.
 *
 * Sizes and filenames come from PNG_TARGETS in icon-art.mjs, which
 * scripts/pwa.test.mjs also reads, so the files on disk, this generator and the
 * manifest cannot disagree.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG_TARGETS, iconSvg, renderPng } from './icon-art.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');

mkdirSync(publicDir, { recursive: true });

for (const [name, size, variant] of PNG_TARGETS) {
  const bytes = renderPng(size, variant);
  writeFileSync(join(publicDir, name), bytes);
  console.log(`  ${name.padEnd(24)} ${size}x${size}  ${variant.padEnd(9)} ${bytes.length} bytes`);
}

writeFileSync(join(publicDir, 'icon.svg'), iconSvg('any'));
console.log(`  ${'icon.svg'.padEnd(24)} 512x512  any       (favicon)`);
