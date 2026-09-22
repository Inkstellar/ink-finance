import OpenAI from 'openai';
import type { ProductDetails } from './types';

/**
 * Turn a shopping URL into structured product details.
 *
 * Two hops: Jina Reader (r.jina.ai) renders the page to clean Markdown, which
 * sidesteps most bot-blocking and the "JS-only" markup of Amazon/Flipkart, and
 * then the AI extracts the handful of fields we store.
 *
 * The AI client is configured exactly like ai-vision.ts — AI_API_KEY /
 * AI_BASE_URL / AI_MODEL — because that is what the Render services actually
 * have set. Reading OPENAI_API_KEY here would have worked locally and failed
 * in production, where only the router credentials exist.
 */
const apiKey = process.env.AI_API_KEY!;
const baseURL = process.env.AI_BASE_URL!;
const model = process.env.AI_MODEL || 'agnes-2.5-flash';

/** Same fallback idea as the receipt analyser: try each until one works. */
const FALLBACK_MODELS = [...new Set([
  model,
  'agnes-2.5-flash',
  'ling-3.0-flash-vl-free',
])];

const client = new OpenAI({ apiKey, baseURL });

/** Give up on the reader rather than hanging the bot's message handler. */
const READER_TIMEOUT_MS = 30_000;

/** Cap what we hand the model, so one huge page can't blow up the request. */
const MAX_MARKDOWN_CHARS = 12_000;

export type { ProductDetails };

/**
 * Price arrives from the model as free text ("₹1,299", "1299.00", "N/A").
 * Returns null for anything that is not a finite positive number — a NaN
 * would reach Postgres as an invalid float and fail the whole insert.
 */
function parsePrice(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;

  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;

  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Trim to a string, or null — the model sometimes returns objects/arrays. */
function parseText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
}

async function extractWithModel(
  modelName: string,
  markdown: string,
): Promise<ProductDetails> {
  const prompt = `You are a shopping assistant. Extract the following details from the
markdown of a product page below.

- Product Name: be precise, drop site names and marketing suffixes
- Price: numerical value only, no currency symbols or thousands separators
- Currency: ISO code, e.g. INR, USD
- Primary Product Image URL: the main product image (must be an absolute http(s) URL)
- Short Description: one sentence
- Review Summary: e.g. "4.5 stars from 1k reviews"

Use null for any field that is genuinely not present. Never invent a price.

Markdown content:
${markdown.slice(0, MAX_MARKDOWN_CHARS)}`;

  const aiResponse = await client.chat.completions.create({
    model: modelName,
    messages: [
      {
        role: 'system',
        content:
          'You are a precise data extractor. Return ONLY a JSON object, no prose and no markdown fences.',
      },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
  });

  const data = JSON.parse(aiResponse.choices[0]?.message?.content || '{}') as Record<string, unknown>;

  const name = parseText(data.name) ?? parseText(data.productName);

  return {
    name: name ?? 'Unknown Product',
    price: parsePrice(data.price),
    currency: parseText(data.currency)?.toUpperCase() ?? 'INR',
    imageUrl: parseText(data.imageUrl),
    description: parseText(data.description),
    reviews: parseText(data.reviews),
  };
}

/**
 * Extracts product details from a shopping URL.
 * Throws when the page cannot be read or no model returns usable JSON, so the
 * caller can tell the user something went wrong instead of saving a blank row.
 */
export async function extractProductDetails(url: string): Promise<ProductDetails> {
  const response = await fetch(`https://r.jina.ai/${url}`, {
    headers: { 'X-Return-Format': 'markdown' },
    signal: AbortSignal.timeout(READER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch page content via Jina Reader: ${response.status} ${response.statusText}`);
  }

  const markdown = await response.text();
  if (!markdown.trim()) {
    throw new Error('The page came back empty — it may be login-gated or blocking readers.');
  }

  let lastError: unknown;
  for (const m of FALLBACK_MODELS) {
    try {
      const details = await extractWithModel(m, markdown);
      if (m !== model) {
        console.log(`[wishlist-scraper] ⚠️ Primary "${model}" failed — used fallback "${m}"`);
      }
      return details;
    } catch (err) {
      lastError = err;
      console.error(
        `[wishlist-scraper] Model ${m} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  throw new Error(
    `Could not read the product details. ${
      lastError instanceof Error ? lastError.message.slice(0, 120) : 'All models failed.'
    }`,
  );
}
