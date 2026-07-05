import { describe, it, expect, vi, afterEach } from 'vitest';

function makeRequest(barcode: string): Request {
  return new Request(`http://test/api/product-lookup?barcode=${encodeURIComponent(barcode)}`);
}

// Minimal fake Cache/CacheStorage so the Function's `caches.default` calls
// don't blow up under Node's test environment (which has no Cache API).
function makeFakeCaches() {
  const store = new Map<string, Response>();
  return {
    default: {
      match: async (req: Request) => store.get(req.url)?.clone() ?? undefined,
      put: async (req: Request, res: Response) => {
        store.set(req.url, res.clone());
      },
    },
  };
}

async function runHandler(handler: any, request: Request, waitUntil: (p: Promise<any>) => void = () => {}) {
  return handler({ request, env: {}, params: {}, waitUntil } as any);
}

describe('GET /api/product-lookup', () => {
  const originalFetch = global.fetch;
  const originalCaches = (global as any).caches;

  afterEach(() => {
    global.fetch = originalFetch;
    (global as any).caches = originalCaches;
    vi.restoreAllMocks();
  });

  it('rejects non-numeric or malformed barcodes without calling upstream', async () => {
    (global as any).caches = makeFakeCaches();
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    const { onRequestGet } = await import('../functions/api/product-lookup');
    const response = await runHandler(onRequestGet, makeRequest('not-a-barcode'));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns found:true with normalized fields for a known product', async () => {
    (global as any).caches = makeFakeCaches();
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: 1,
          product: {
            product_name: 'Nutella',
            brands: 'Ferrero, Nutella',
            categories_tags: ['en:spreads', 'en:sweet-spreads'],
            quantity: '400g',
            image_front_small_url: 'https://images.openfoodfacts.org/x.jpg',
            nutriments: { 'energy-kcal_100g': 539, fat_100g: 30.9, carbohydrates_100g: 57.5, proteins_100g: 6.3 },
          },
        }),
        { status: 200 }
      )
    ) as any;

    const { onRequestGet } = await import('../functions/api/product-lookup');
    const response = await runHandler(onRequestGet, makeRequest('3017620422003'));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.found).toBe(true);
    expect(data.name).toContain('Nutella');
    expect(typeof data.category).toBe('string');
    expect(data.category.length).toBeGreaterThan(0);
    expect(data.imageUrl).toBe('https://images.openfoodfacts.org/x.jpg');
    expect(data.nutrition.energy_kcal_100g).toBe(539);
  });

  it('returns found:false for a barcode with no matching product', async () => {
    (global as any).caches = makeFakeCaches();
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ status: 0 }), { status: 200 })) as any;

    const { onRequestGet } = await import('../functions/api/product-lookup');
    const response = await runHandler(onRequestGet, makeRequest('9999999999991'));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.found).toBe(false);
  });

  it('returns 502 when the upstream service is unreachable', async () => {
    (global as any).caches = makeFakeCaches();
    global.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as any;

    const { onRequestGet } = await import('../functions/api/product-lookup');
    const response = await runHandler(onRequestGet, makeRequest('3017620422003'));
    expect(response.status).toBe(502);
  });

  it('serves a second request for the same barcode from cache without calling upstream again', async () => {
    (global as any).caches = makeFakeCaches();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: 1, product: { product_name: 'Milk' } }), { status: 200 })
    );
    global.fetch = fetchMock as any;

    const { onRequestGet } = await import('../functions/api/product-lookup');
    const waits: Promise<any>[] = [];
    const waitUntil = (p: Promise<any>) => waits.push(p);

    const r1 = await runHandler(onRequestGet, makeRequest('1111111111116'), waitUntil);
    expect(r1.status).toBe(200);
    await Promise.all(waits);

    const r2 = await runHandler(onRequestGet, makeRequest('1111111111116'), waitUntil);
    expect(r2.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
