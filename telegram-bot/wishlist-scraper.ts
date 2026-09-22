import OpenAI from 'openai';
import type { ProductDetails } from './types';
import { toProductDetails } from './product-parse';

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

/**
 * Cap what we hand the model, so one huge page can't blow up the request.
 *
 * This has to clear the page's navigation block, which is not small: on an
 * Amazon India product page the chrome (skip links, menus, keyboard shortcuts)
 * runs to roughly 12 KB, and the price sits just past it at ~12.5 KB. A 12 KB
 * cap therefore sent the model a menu and nothing else, and every scrape came
 * back with no price. Real pages run 100–400 KB, so 60 KB covers the product
 * region without paying for the recommendations at the bottom.
 */
const MAX_MARKDOWN_CHARS = 60_000;

export type { ProductDetails };

async function extractWithModel(
  modelName: string,
  markdown: string,
): Promise<ProductDetails> {
  const prompt = `You are a shopping assistant. Extract the product details from the
markdown of a product page below.

Respond with ONLY a JSON object — no markdown fences, no commentary — using
exactly these keys:
{
  "name": "the product name, precise, without the site name or marketing suffixes",
  "price": 1049.00,
  "currency": "INR",
  "imageUrl": "https://…",
  "description": "one sentence",
  "reviews": "4.2 out of 5 stars from 41 reviews"
}

Rules:
- "price" is a number only — no currency symbol, no thousands separator.
- "currency" is an ISO code, e.g. INR or USD.
- "imageUrl" must be an absolute http(s) URL of the main product image.
- Use null for any field that is genuinely not present. Never invent a price.

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

  return toProductDetails(data);
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
