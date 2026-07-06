import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env as BaseEnv } from '../_middleware';

// Extends the shared Env with the secret needed to talk to Google AI
// Studio's Gemini API. GEMINI_API_KEY must be set as an encrypted
// environment variable in the Cloudflare Pages project settings (Settings
// -> Environment variables -> Production/Preview -> "GEMINI_API_KEY",
// type "Secret"), obtained from https://aistudio.google.com/apikey.
//
// Why an LLM and not "real" OCR: a plain OCR engine gives you a flat blob
// of recognized text with no idea which numbers are prices, which lines
// are item names vs. store metadata, or how to handle a receipt printed
// at an angle/faded thermal paper/a discount line directly under an item.
// A vision-capable LLM can be asked directly for structured
// {name, price, quantity}[] and generalizes across wildly different
// receipt layouts without per-store parsing rules. This mirrors exactly
// the bug-report flow's precedent (functions/api/bug-report.ts) of an
// optional server-side secret that a feature depends on: fully documented
// here, checked defensively, and the feature degrades to "not configured
// yet" (never a hard crash) if the key isn't set.
export interface Env extends BaseEnv {
  GEMINI_API_KEY?: string;
}

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const PROMPT = `You are reading a photo of a supermarket/shop receipt. Extract every purchased line item.
Respond with ONLY a JSON object (no markdown fences, no commentary) matching exactly this shape:
{
  "merchant": string | null,
  "total": number | null,
  "items": [ { "name": string, "price": number | null, "quantity": string | null } ]
}
Rules:
- "price" is the line's total price in the receipt's currency, as a plain number (e.g. 2.49), or null if unreadable.
- "quantity" is a short human string if the receipt shows one (e.g. "2x", "500g"), otherwise null.
- Skip subtotal/tax/total/payment/loyalty-points lines -- only actual purchased items.
- Skip discount/coupon lines unless they're the only content of a row (in which case skip them too).
- If the image isn't a receipt at all, return { "merchant": null, "total": null, "items": [] }.`;

interface GeminiLineItem {
  name?: unknown;
  price?: unknown;
  quantity?: unknown;
}

interface GeminiReceiptResult {
  merchant?: unknown;
  total?: unknown;
  items?: unknown;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// Defensive parsing of whatever the model actually returned -- even with
// an explicit "respond with only JSON" instruction, a vision model can
// still wrap its answer in a markdown code fence or add stray whitespace,
// so this strips a leading/trailing ```json fence before parsing rather
// than trusting the response to be bare JSON.
function extractJson(text: string): GeminiReceiptResult | null {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    // Not an error -- the frontend checks `configured` and shows a
    // friendly "ask an admin to set this up" state rather than treating
    // this as a failed scan, exactly like the bug-report button does when
    // GITHUB_PAT isn't set (see functions/api/bug-report.ts).
    return Response.json({ configured: false, items: [], total: null, merchant: null });
  }

  let body: { image?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/.exec(body.image || '');
  if (!match) {
    return new Response(JSON.stringify({ error: 'image must be a data:image/(png|jpeg|webp);base64,... URL' }), { status: 400 });
  }
  const [, mimeType, base64Data] = match;

  let upstream: Response;
  try {
    upstream = await fetch(`${GEMINI_API}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: mimeType, data: base64Data } },
          ],
        }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Receipt scanning service unreachable' }), { status: 502 });
  }

  if (!upstream.ok) {
    const errorText = await upstream.text();
    console.error('Gemini receipt scan failed', upstream.status, errorText);
    return new Response(JSON.stringify({ error: 'Receipt scanning failed' }), { status: 502 });
  }

  const data = await upstream.json<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = extractJson(rawText);
  if (!parsed) {
    console.error('Gemini receipt scan returned unparseable output', rawText);
    return new Response(JSON.stringify({ error: 'Could not parse receipt' }), { status: 502 });
  }

  const items = (Array.isArray(parsed.items) ? parsed.items : [])
    .map((raw: GeminiLineItem) => ({
      name: toNullableString(raw?.name) || 'Unbekannter Artikel',
      price: toNullableNumber(raw?.price),
      quantity: toNullableString(raw?.quantity),
    }))
    .filter((item: { name: string }) => item.name);

  return Response.json({
    configured: true,
    items,
    total: toNullableNumber(parsed.total),
    merchant: toNullableString(parsed.merchant),
  });
};
