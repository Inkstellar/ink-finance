import OpenAI from 'openai';
import type { ReceiptAnalysis } from './types.js';

const apiKey = process.env.AI_API_KEY!;
const baseURL = process.env.AI_BASE_URL!;
// Primary model + fallback chain (tried in order if the primary fails)
const model = process.env.AI_MODEL || 'agnes-2.5-flash';
const FALLBACK_MODELS = [...new Set([
  model,
  'ling-3.0-flash-vl-free',
  'agnes-2.5-flash',
])];

const client = new OpenAI({ apiKey, baseURL });

/**
 * Default category list used when the API has no categories yet.
 * The AI is told to pick from this list; new ones are created on the fly.
 */
export const DEFAULT_CATEGORIES = [
  'Groceries', 'Utilities', 'Transport', 'Fuel', 'Dining',
  'Shopping', 'Entertainment', 'Healthcare', 'Education',
  'Rent', 'Salary', 'Investment', 'Insurance', 'Phone',
  'Internet', 'Subscriptions', 'Transfer', 'Refund', 'Other',
] as const;

/**
 * Send a receipt/bill screenshot to the AI vision model and get back
 * structured data: merchant, amount, date, category, type.
 * Tries each model in FALLBACK_MODELS order until one succeeds.
 */
export async function analyzeReceipt(
  base64Image: string,
  knownCategories: string[],
): Promise<ReceiptAnalysis | null> {
  for (const m of FALLBACK_MODELS) {
    try {
      const result = await callVision(m, base64Image, knownCategories);
      if (m !== model) {
        console.log(`[ai-vision] ⚠️ Primary "${model}" failed — used fallback "${m}"`);
      }
      return result;
    } catch (err) {
      console.error(`[ai-vision] Model ${m} failed:`, err instanceof Error ? err.message : err);
    }
  }
  console.error('[ai-vision] All models failed');
  return null;
}

/**
 * Calls one vision model. Throws on API/network errors so the
 * fallback chain in analyzeReceipt can try the next model.
 */
async function callVision(
  modelName: string,
  base64Image: string,
  knownCategories: string[],
): Promise<ReceiptAnalysis | null> {
  const categoryList = knownCategories.length
    ? knownCategories
    : [...DEFAULT_CATEGORIES];

  const prompt = `You are a receipt, bill, and UPI payment screenshot analyser.
Examine the image and extract:

1. **merchant**  — the shop / company / person paid (or who paid you)
2. **amount**    — total amount in INR (number only, no symbol)
3. **date**      — transaction date in YYYY-MM-DD (use today's date if not visible)
4. **category**  — pick the CLOSEST match from this list: ${categoryList.join(', ')}
5. **type**      — "EXPENSE" for payments/bills/purchases, "INCOME" for refunds/salary/credits
6. **paymentMethod** — UPI, Card, Cash, Net Banking, Wallet, etc. (if visible)
7. **rawText**   — key lines from the receipt (merchant, items, total, date)
8. **confidence** — 0.0 to 1.0 — how confident you are in the extraction

Respond with ONLY a JSON object — no markdown fences, no commentary:
{
  "merchant": "string",
  "amount": 123.45,
  "date": "2026-09-19",
  "category": "Groceries",
  "type": "EXPENSE",
  "paymentMethod": "UPI",
  "rawText": "BigBasket\\nOrder #12345\\nTotal: Rs 1,234.50\\nDate: 19/09/2026",
  "confidence": 0.9
}

If the image is NOT a bill/receipt/payment, return:
{ "merchant": "", "amount": 0, "date": "", "category": "Other", "type": "EXPENSE", "rawText": "", "confidence": 0 }

For UPI screenshots (PhonePe, GPay, Paytm, BHIM):
- merchant = recipient name or merchant name
- amount = the paid amount
- date = transaction date
- paymentMethod = "UPI"`;

  const completion = await client.chat.completions.create({
    model: modelName,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${base64Image}`,
            },
          },
        ],
      },
    ],
    max_tokens: 800,
    temperature: 0.1,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from model');

  // The model might wrap JSON in ```json fences — extract the object
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in response: ${content.slice(0, 100)}`);

  const parsed = JSON.parse(jsonMatch[0]);

  // Not a receipt (confidence 0) or unreadable → return as-is, caller decides
  return {
    merchant:  parsed.merchant?.trim() || 'Unknown',
    amount:    parseFloat(parsed.amount) || 0,
    date:      parsed.date || new Date().toISOString().slice(0, 10),
    category:  parsed.category?.trim() || 'Other',
    type:      parsed.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
    paymentMethod: parsed.paymentMethod?.trim() || undefined,
    rawText:   parsed.rawText?.trim() || undefined,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
  };
}
