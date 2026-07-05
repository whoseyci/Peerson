import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';

// Looks up a barcode against Open Food Facts (world.openfoodfacts.org) --
// a free, keyless, community-maintained product database. Proxying this
// server-side (rather than calling it directly from the browser) lets us:
//   - cache successful lookups at Cloudflare's edge, since the same
//     barcode gets scanned by many households and product data rarely
//     changes;
//   - normalize the response into exactly the shape the frontend needs,
//     insulating the app from upstream schema changes;
//   - swap/add data sources later (e.g. a private catalog) without
//     touching the client.
const OFF_BASE = 'https://world.openfoodfacts.org/api/v2/product';
const FIELDS = 'code,product_name,brands,categories_tags,quantity,image_front_small_url,nutriments';

// Rough keyword -> household category mapping. Open Food Facts' category
// taxonomy is huge and multi-lingual; we only need a "good enough" first
// guess the user can correct with one tap, not a perfect classifier.
const CATEGORY_RULES: Array<{ match: RegExp; category: string }> = [
  { match: /beverage|drink|water|soda|juice|coffee|tea/, category: 'getraenke' },
  { match: /bread|cereal|pasta|rice|flour|grain/, category: 'getreide' },
  { match: /vegetable|legume/, category: 'gemuese' },
  { match: /fruit/, category: 'obst' },
  { match: /dairy|milk|cheese|yogurt|yoghurt|cream/, category: 'milch' },
  { match: /meat|fish|egg|poultry|sausage|seafood/, category: 'proteine' },
  { match: /fat|oil|butter|margarine/, category: 'fette' },
  { match: /canned|frozen|ready-to-eat|ready-meal|snack/, category: 'fertig' },
];

function guessCategory(categoriesTags: string[] = []): string {
  const haystack = categoriesTags.join(' ').toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.match.test(haystack)) return rule.category;
  }
  return 'sonstiges';
}

export const onRequestGet: PagesFunction<Env> = async ({ request, waitUntil }) => {
  const url = new URL(request.url);
  const barcode = (url.searchParams.get('barcode') || '').trim();

  if (!/^\d{6,14}$/.test(barcode)) {
    return new Response(JSON.stringify({ error: 'Invalid barcode' }), { status: 400 });
  }

  const cache = (caches as any).default;
  const cacheKey = new Request(`https://peerson-product-cache.internal/${barcode}`);
  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached) return cached;

  let upstream: Response;
  try {
    upstream = await fetch(`${OFF_BASE}/${barcode}.json?fields=${FIELDS}`, {
      headers: { 'User-Agent': 'Peerson-App/1.0 (household inventory app)' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Product lookup service unreachable' }), { status: 502 });
  }

  if (!upstream.ok) {
    return new Response(JSON.stringify({ error: 'Product lookup failed' }), { status: 502 });
  }

  const data = await upstream.json<{
    status: number;
    product?: {
      product_name?: string;
      brands?: string;
      categories_tags?: string[];
      quantity?: string;
      image_front_small_url?: string;
      nutriments?: Record<string, number>;
    };
  }>();

  let responseBody: Record<string, unknown>;
  if (data.status !== 1 || !data.product?.product_name) {
    responseBody = { found: false, barcode };
  } else {
    const p = data.product;
    responseBody = {
      found: true,
      barcode,
      name: p.brands ? `${p.product_name} (${p.brands.split(',')[0].trim()})` : p.product_name,
      category: guessCategory(p.categories_tags),
      quantity: p.quantity || null,
      imageUrl: p.image_front_small_url || null,
      nutrition: {
        energy_kcal_100g: p.nutriments?.['energy-kcal_100g'] ?? null,
        fat_100g: p.nutriments?.fat_100g ?? null,
        carbohydrates_100g: p.nutriments?.carbohydrates_100g ?? null,
        proteins_100g: p.nutriments?.proteins_100g ?? null,
      },
    };
  }

  const response = Response.json(responseBody, {
    headers: { 'Cache-Control': 'public, max-age=86400' },
  });
  if (cache) {
    // waitUntil keeps the Worker alive long enough for the cache write to
    // finish even though we've already returned the response to the client.
    waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
};
