import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1 } from './mocks/d1';
import type { Env } from '../functions/_middleware';

function makeRequest(url: string, opts: RequestInit = {}, userId = 'test-user'): Request {
  return new Request(url, {
    ...opts,
    headers: {
      'X-User-Id': userId,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  });
}

async function runHandler(handler: any, request: Request, env: Env, params = {}) {
  return handler({ request, env, params } as any);
}

// Price history is deliberately NOT one row per purchase -- see
// functions/api/items/[id].ts for the full design rationale. These tests
// prove: (1) setting a price for the first time creates no history row,
// (2) re-saving the same price is a no-op (no spurious history growth),
// (3) an actual price change pushes exactly one closed history entry, and
// (4) the entry's effective_from/effective_until form a gapless timeline.
describe('Item price + price history', () => {
  let env: Env;
  let d1: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    d1 = createMockD1();
    d1.seedMembership('house-1', 'test-user');
    env = { DB: d1 } as unknown as Env;
  });

  it('setting an initial price does not create a history row', async () => {
    (d1 as any).seedItem({
      id: 'i1', household_id: 'house-1', name: 'Nudeln', price_cents: null, created_at: 1000,
      barcodes: '[]', nutrition: '{}',
    });
    const { onRequestPatch } = await import('../functions/api/items/[id]');
    const res = await runHandler(onRequestPatch, makeRequest('http://test/items/i1', {
      method: 'PATCH', body: JSON.stringify({ price_cents: 199 }),
    }), env, { id: 'i1' });
    const body = await res.json();
    expect(body.item.price_cents).toBe(199);

    const { onRequestGet: getHistory } = await import('../functions/api/items/[id]/price-history');
    const historyRes = await runHandler(getHistory, makeRequest('http://test/items/i1/price-history'), env, { id: 'i1' });
    const history = (await historyRes.json()).history;
    expect(history).toEqual([]);
  });

  it('re-saving the same price is a no-op and does not grow history', async () => {
    (d1 as any).seedItem({
      id: 'i1', household_id: 'house-1', name: 'Nudeln', price_cents: 199, created_at: 1000,
      barcodes: '[]', nutrition: '{}',
    });
    const { onRequestPatch } = await import('../functions/api/items/[id]');
    await runHandler(onRequestPatch, makeRequest('http://test/items/i1', {
      method: 'PATCH', body: JSON.stringify({ price_cents: 199 }),
    }), env, { id: 'i1' });

    const { onRequestGet: getHistory } = await import('../functions/api/items/[id]/price-history');
    const historyRes = await runHandler(getHistory, makeRequest('http://test/items/i1/price-history'), env, { id: 'i1' });
    const history = (await historyRes.json()).history;
    expect(history.length).toBe(0);
  });

  it('changing the price pushes the old price to history and updates the current price', async () => {
    (d1 as any).seedItem({
      id: 'i1', household_id: 'house-1', name: 'Nudeln', price_cents: 199, created_at: 1000,
      barcodes: '[]', nutrition: '{}',
    });
    const { onRequestPatch } = await import('../functions/api/items/[id]');
    const res = await runHandler(onRequestPatch, makeRequest('http://test/items/i1', {
      method: 'PATCH', body: JSON.stringify({ price_cents: 249 }),
    }), env, { id: 'i1' });
    const body = await res.json();
    expect(body.item.price_cents).toBe(249);

    const { onRequestGet: getHistory } = await import('../functions/api/items/[id]/price-history');
    const historyRes = await runHandler(getHistory, makeRequest('http://test/items/i1/price-history'), env, { id: 'i1' });
    const history = (await historyRes.json()).history;
    expect(history.length).toBe(1);
    expect(history[0].price_cents).toBe(199);
    expect(history[0].effective_from).toBe(1000); // item's created_at, first-ever change
    expect(typeof history[0].effective_until).toBe('number');
  });

  it('a second price change chains gaplessly off the first history entry', async () => {
    (d1 as any).seedItem({
      id: 'i1', household_id: 'house-1', name: 'Nudeln', price_cents: 199, created_at: 1000,
      barcodes: '[]', nutrition: '{}',
    });
    const { onRequestPatch } = await import('../functions/api/items/[id]');
    await runHandler(onRequestPatch, makeRequest('http://test/items/i1', {
      method: 'PATCH', body: JSON.stringify({ price_cents: 249 }),
    }), env, { id: 'i1' });
    await runHandler(onRequestPatch, makeRequest('http://test/items/i1', {
      method: 'PATCH', body: JSON.stringify({ price_cents: 299 }),
    }), env, { id: 'i1' });

    const { onRequestGet: getHistory } = await import('../functions/api/items/[id]/price-history');
    const historyRes = await runHandler(getHistory, makeRequest('http://test/items/i1/price-history'), env, { id: 'i1' });
    const history = (await historyRes.json()).history;
    expect(history.length).toBe(2);
    // Sorted oldest first; the 2nd entry's effective_from must equal the
    // 1st entry's effective_until -- a gapless timeline, not two disjoint
    // "sometime in the past" blobs.
    expect(history[0].price_cents).toBe(199);
    expect(history[1].price_cents).toBe(249);
    expect(history[1].effective_from).toBe(history[0].effective_until);

    const { onRequestGet: getItems } = await import('../functions/api/items');
    const itemsRes = await runHandler(getItems, makeRequest('http://test/api/items?householdId=house-1'), env);
    const items = (await itemsRes.json()).items;
    expect(items.find((i: any) => i.id === 'i1').price_cents).toBe(299);
  });
});
