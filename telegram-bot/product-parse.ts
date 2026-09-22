/**
 * Turning the model's JSON into `ProductDetails`.
 *
 * Split out from wishlist-scraper.ts so it can be tested without an API key —
 * importing the scraper constructs an OpenAI client, which throws when the key
 * is absent, and CI is deliberately secret-free. Same reasoning as
 * scripts/backup-format.mjs.
 */
import type { ProductDetails } from './types';

export type { ProductDetails };

/**
 * Read a field whatever the model decided to call it.
 *
 * The prompt names each field, and the model echoes that label back as the
 * JSON key — ask for "Product Name" and you get `{"Product Name": …}`, not
 * `{"name": …}`. Silently reading only `data.name` is how a page that scraped
 * perfectly (name, image and description all correct) still saved as
 * "Unknown Product" with no price. Keys are compared ignoring case, spaces,
 * underscores and hyphens, so `Product Name`, `product_name` and `productName`
 * all land in the same place.
 */
export function pick(data: Record<string, unknown>, ...names: string[]): unknown {
  const flatten = (key: string) => key.toLowerCase().replace(/[\s_-]/g, '');

  const byKey = new Map<string, unknown>();
  for (const [key, value] of Object.entries(data)) {
    byKey.set(flatten(key), value);
  }

  for (const name of names) {
    const value = byKey.get(flatten(name));
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

/**
 * Price arrives from the model as free text ("₹1,299", "1299.00", "N/A").
 * Returns null for anything that is not a finite number — a NaN would reach
 * Postgres as an invalid float and fail the whole insert.
 *
 * Only dots *between* digits survive as a decimal point. Keeping every dot
 * turns "Rs. 1299" into ".1299", which parses as twelve paise.
 */
export function parsePrice(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw !== 'string') return null;

  const cleaned = raw
    .replace(/[^0-9.]/g, '')
    .replace(/(?<![0-9])\.|\.(?![0-9])/g, '');
  if (!cleaned || !/[0-9]/.test(cleaned)) return null;

  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Trim to a string, or null — the model sometimes returns objects/arrays. */
export function parseText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * Map the model's JSON onto the fields the app stores.
 *
 * The name falls back to "Unknown Product" rather than null because the schema
 * requires one, and a row with a name the user can see and correct beats a
 * scrape that reports nothing at all.
 */
export function toProductDetails(data: Record<string, unknown>): ProductDetails {
  return {
    name: parseText(pick(data, 'name', 'productName', 'title')) ?? 'Unknown Product',
    price: parsePrice(pick(data, 'price', 'currentPrice', 'amount')),
    currency: parseText(pick(data, 'currency'))?.toUpperCase() ?? 'INR',
    imageUrl: parseText(pick(data, 'imageUrl', 'primaryImageUrl', 'primaryProductImageUrl', 'productImage', 'image')),
    description: parseText(pick(data, 'description', 'shortDescription', 'summary')),
    reviews: parseText(pick(data, 'reviews', 'reviewSummary', 'rating')),
  };
}
