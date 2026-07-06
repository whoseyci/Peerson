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

describe('Batch location_id + move', () => {
  let env: Env;
  let d1: ReturnType<typeof createMockD1>;

  const KITCHEN_ID = 'kitchen';
  const GARAGE_ID = 'garage-fridge';

  beforeEach(() => {
    d1 = createMockD1();
    d1.seedMembership('house-1', 'test-user');
    d1.seed('locations', [
      { id: KITCHEN_ID, household_id: 'house-1', parent_id: null, name: 'Küche', sort_order: 0 },
      { id: GARAGE_ID, household_id: 'house-1', parent_id: null, name: 'Garagenkühlschrank', sort_order: 1 },
    ]);
    d1.seedItem({ id: 'item-1', household_id: 'house-1', name: 'Milch', category: 'milch', threshold: 2, location_id: KITCHEN_ID, barcodes: '[]', nutrition: '{}' });
    env = { DB: d1 } as unknown as Env;
  });

  it('POST /api/batches accepts an explicit location_id different from the item', async () => {
    const { onRequestPost } = await import('../functions/api/batches');
    const req = makeRequest('http://test/api/batches', {
      method: 'POST',
      body: JSON.stringify({ item_id: 'item-1', quantity: 2, location_id: 'garage-fridge' }),
    });
    const res = await runHandler(onRequestPost, req, env);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.batch.location_id).toBe('garage-fridge');
  });

  it('POST /api/batches omitting location_id leaves it unset (inherits the item location)', async () => {
    const { onRequestPost } = await import('../functions/api/batches');
    const req = makeRequest('http://test/api/batches', {
      method: 'POST',
      body: JSON.stringify({ item_id: 'item-1', quantity: 1 }),
    });
    const res = await runHandler(onRequestPost, req, env);
    const body = await res.json();
    expect(body.batch.location_id ?? null).toBeNull();
  });

  it('PATCH /api/batches/:id can relocate an existing batch', async () => {
    const { onRequestPost } = await import('../functions/api/batches');
    const created = await (await runHandler(onRequestPost, makeRequest('http://test/api/batches', {
      method: 'POST', body: JSON.stringify({ item_id: 'item-1', quantity: 3 }),
    }), env)).json();

    const { onRequestPatch } = await import('../functions/api/batches/[id]');
    const patchRes = await runHandler(onRequestPatch, makeRequest(`http://test/batches/${created.batch.id}`, {
      method: 'PATCH', body: JSON.stringify({ location_id: 'garage-fridge' }),
    }), env, { id: created.batch.id });
    const patched = (await patchRes.json()).batch;
    expect(patched.location_id).toBe('garage-fridge');
  });

  describe('POST /api/batches/move', () => {
    it('moves an entire batch when the requested quantity covers it', async () => {
      const { onRequestPost: createBatch } = await import('../functions/api/batches');
      await runHandler(createBatch, makeRequest('http://test/api/batches', {
        method: 'POST', body: JSON.stringify({ item_id: 'item-1', quantity: 4, expiry: '2030-01-01' }),
      }), env);

      const { onRequestPost: move } = await import('../functions/api/batches/move');
      const res = await runHandler(move, makeRequest('http://test/api/batches/move', {
        method: 'POST',
        body: JSON.stringify({ item_id: 'item-1', from_location_id: 'kitchen', to_location_id: 'garage-fridge', quantity: 4 }),
      }), env);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.moved).toBe(4);
      expect(body.batches.every((b: any) => b.location_id === 'garage-fridge')).toBe(true);
    });

    it('splits a batch when the requested quantity is less than the batch size, preserving expiry on both halves', async () => {
      const { onRequestPost: createBatch } = await import('../functions/api/batches');
      await runHandler(createBatch, makeRequest('http://test/api/batches', {
        method: 'POST', body: JSON.stringify({ item_id: 'item-1', quantity: 5, expiry: '2030-06-01', price: 2.5 }),
      }), env);

      const { onRequestPost: move } = await import('../functions/api/batches/move');
      const res = await runHandler(move, makeRequest('http://test/api/batches/move', {
        method: 'POST',
        body: JSON.stringify({ item_id: 'item-1', from_location_id: 'kitchen', to_location_id: 'garage-fridge', quantity: 2 }),
      }), env);
      const body = await res.json();
      expect(body.moved).toBe(2);

      const total = body.batches.reduce((a: number, b: any) => a + b.quantity, 0);
      expect(total).toBe(5);
      const moved = body.batches.find((b: any) => b.location_id === 'garage-fridge');
      const remainder = body.batches.find((b: any) => (b.location_id ?? null) !== 'garage-fridge');
      expect(moved.quantity).toBe(2);
      expect(remainder.quantity).toBe(3);
      expect(moved.expiry).toBe('2030-06-01');
      expect(remainder.expiry).toBe('2030-06-01');
    });

    it('walks multiple batches oldest-first (FIFO) to cover a quantity spanning more than one batch', async () => {
      const { onRequestPost: createBatch } = await import('../functions/api/batches');
      // Oldest batch first (mock D1 date_added uses Date.now(), so create
      // sequentially -- order in the array reflects insertion order which
      // the move handler sorts by date_added ASC anyway).
      await runHandler(createBatch, makeRequest('http://test/api/batches', {
        method: 'POST', body: JSON.stringify({ item_id: 'item-1', quantity: 2, expiry: '2030-01-01' }),
      }), env);
      await runHandler(createBatch, makeRequest('http://test/api/batches', {
        method: 'POST', body: JSON.stringify({ item_id: 'item-1', quantity: 3, expiry: '2030-02-01' }),
      }), env);

      const { onRequestPost: move } = await import('../functions/api/batches/move');
      const res = await runHandler(move, makeRequest('http://test/api/batches/move', {
        method: 'POST',
        body: JSON.stringify({ item_id: 'item-1', from_location_id: 'kitchen', to_location_id: 'garage-fridge', quantity: 4 }),
      }), env);
      const body = await res.json();
      expect(body.moved).toBe(4);
      // First batch (2 units, earliest expiry) fully moved; second batch
      // (3 units) partially moved (2 of 3), leaving 1 behind.
      const movedBatches = body.batches.filter((b: any) => b.location_id === 'garage-fridge');
      const movedTotal = movedBatches.reduce((a: number, b: any) => a + b.quantity, 0);
      expect(movedTotal).toBe(4);
    });

    it('rejects a move with a non-positive quantity', async () => {
      const { onRequestPost: move } = await import('../functions/api/batches/move');
      const res = await runHandler(move, makeRequest('http://test/api/batches/move', {
        method: 'POST',
        body: JSON.stringify({ item_id: 'item-1', from_location_id: 'kitchen', to_location_id: 'garage-fridge', quantity: 0 }),
      }), env);
      expect(res.status).toBe(400);
    });

    it('rejects moving to a location_id belonging to another household', async () => {
      d1.seedMembership('house-2', 'test-user');
      const { onRequestPost: createLocation } = await import('../functions/api/locations');
      const otherLoc = await (await runHandler(createLocation, makeRequest('http://test/api/locations', {
        method: 'POST', body: JSON.stringify({ household_id: 'house-2', name: 'Keller' }),
      }), env)).json();

      const { onRequestPost: move } = await import('../functions/api/batches/move');
      const res = await runHandler(move, makeRequest('http://test/api/batches/move', {
        method: 'POST',
        body: JSON.stringify({ item_id: 'item-1', from_location_id: 'kitchen', to_location_id: otherLoc.location.id, quantity: 1 }),
      }), env);
      expect(res.status).toBe(400);
    });
  });
});
