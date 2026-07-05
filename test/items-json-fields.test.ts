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

// Regression tests for a real backend bug: items.barcodes and items.nutrition
// are stored in D1 as JSON-stringified TEXT columns (see functions/api/items.ts
// onRequestPost: `JSON.stringify(body.barcodes || [])`), but `SELECT * FROM items`
// returns the raw TEXT value untouched. Nothing parsed it back into an
// array/object before sending it to the client, even though src/types/index.ts
// declares `Item.barcodes: Barcode[]` and `Item.nutrition: Record<string, number>`.
//
// Confirmed via MockD1Database (which -- like real D1 -- stores exactly what is
// bound, no auto-parsing) that a raw SELECT yields `typeof row.barcodes === 'string'`.
describe('items API: barcodes/nutrition JSON columns must be parsed before returning', () => {
  let env: Env;

  beforeEach(() => {
    env = { DB: createMockD1() } as unknown as Env;
    (env.DB as any).seedMembership('h1', 'test-user');
  });

  it('GET /api/items returns barcodes/nutrition as real arrays/objects, not JSON strings', async () => {
    (env.DB as any).seedItem({
      id: 'i1',
      household_id: 'h1',
      name: 'Milk',
      category: 'sonstiges',
      threshold: 0,
      location: '',
      barcodes: JSON.stringify([{ code: '123', grams: 500 }]),
      nutrition: JSON.stringify({ kcal: 42 }),
    });

    const { onRequestGet } = await import('../functions/api/items');
    const request = makeRequest('http://test/api/items?householdId=h1');
    const response = await runHandler(onRequestGet, request, env);
    const body = await response.json();

    expect(Array.isArray(body.items[0].barcodes)).toBe(true);
    expect(body.items[0].barcodes).toEqual([{ code: '123', grams: 500 }]);
    expect(typeof body.items[0].nutrition).toBe('object');
    expect(body.items[0].nutrition).toEqual({ kcal: 42 });
  });

  it('POST /api/items returns the freshly-created item with barcodes/nutrition already parsed', async () => {
    const { onRequestPost } = await import('../functions/api/items');
    const request = makeRequest('http://test/api/items', {
      method: 'POST',
      body: JSON.stringify({
        household_id: 'h1',
        name: 'Eggs',
        barcodes: [{ code: '456', grams: 600 }],
        nutrition: { kcal: 70 },
      }),
    });
    const response = await runHandler(onRequestPost, request, env);
    const body = await response.json();

    expect(Array.isArray(body.item.barcodes)).toBe(true);
    expect(body.item.barcodes).toEqual([{ code: '456', grams: 600 }]);
    expect(body.item.nutrition).toEqual({ kcal: 70 });
  });

  it('PATCH /api/items/:id returns the updated item with barcodes/nutrition already parsed', async () => {
    (env.DB as any).seedItem({
      id: 'i2',
      household_id: 'h1',
      name: 'Butter',
      category: 'sonstiges',
      threshold: 0,
      location: '',
      barcodes: JSON.stringify([{ code: '789', grams: 250 }]),
      nutrition: JSON.stringify({ kcal: 10 }),
    });

    const { onRequestPatch } = await import('../functions/api/items/[id]');
    const request = makeRequest('http://test/items/i2', {
      method: 'PATCH',
      body: JSON.stringify({ barcodes: [{ code: '789', grams: 250 }, { code: '999', grams: 100 }] }),
    });
    const response = await runHandler(onRequestPatch, request, env, { id: 'i2' });
    const body = await response.json();

    expect(Array.isArray(body.item.barcodes)).toBe(true);
    expect(body.item.barcodes).toEqual([{ code: '789', grams: 250 }, { code: '999', grams: 100 }]);
    expect(body.item.nutrition).toEqual({ kcal: 10 });
  });
});
