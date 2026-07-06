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

describe('Category Budgets API', () => {
  let env: Env;
  let d1: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    d1 = createMockD1();
    d1.seedMembership('house-1', 'test-user');
    env = { DB: d1 } as unknown as Env;
  });

  it('POST /api/category-budgets creates a new category budget', async () => {
    const { onRequestPost } = await import('../functions/api/category-budgets');
    const req = makeRequest('http://test/api/category-budgets', {
      method: 'POST',
      body: JSON.stringify({ household_id: 'house-1', category: 'groceries', monthly_amount: 300 }),
    });
    const res = await runHandler(onRequestPost, req, env);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.budget.category).toBe('groceries');
    expect(body.budget.monthly_amount).toBe(300);
  });

  it('POST /api/category-budgets performs an upsert when category already has a budget', async () => {
    const { onRequestPost } = await import('../functions/api/category-budgets');
    const req1 = makeRequest('http://test/api/category-budgets', {
      method: 'POST',
      body: JSON.stringify({ household_id: 'house-1', category: 'groceries', monthly_amount: 300 }),
    });
    await runHandler(onRequestPost, req1, env);

    const req2 = makeRequest('http://test/api/category-budgets', {
      method: 'POST',
      body: JSON.stringify({ household_id: 'house-1', category: 'groceries', monthly_amount: 450 }),
    });
    const res2 = await runHandler(onRequestPost, req2, env);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.budget.monthly_amount).toBe(450);
  });

  it('GET /api/category-budgets lists all budgets for household', async () => {
    const { onRequestGet, onRequestPost } = await import('../functions/api/category-budgets');
    await runHandler(onRequestPost, makeRequest('http://test/api/category-budgets', {
      method: 'POST', body: JSON.stringify({ household_id: 'house-1', category: 'groceries', monthly_amount: 300 }),
    }), env);
    await runHandler(onRequestPost, makeRequest('http://test/api/category-budgets', {
      method: 'POST', body: JSON.stringify({ household_id: 'house-1', category: 'leisure', monthly_amount: 150 }),
    }), env);

    const getReq = makeRequest('http://test/api/category-budgets?householdId=house-1');
    const getRes = await runHandler(onRequestGet, getReq, env);
    const body = await getRes.json();
    expect(body.budgets).toHaveLength(2);
    expect(body.budgets.map((b: any) => b.category)).toContain('groceries');
    expect(body.budgets.map((b: any) => b.category)).toContain('leisure');
  });

  it('POST /api/category-budgets deletes budget when monthly_amount is null or 0', async () => {
    const { onRequestGet, onRequestPost } = await import('../functions/api/category-budgets');
    await runHandler(onRequestPost, makeRequest('http://test/api/category-budgets', {
      method: 'POST', body: JSON.stringify({ household_id: 'house-1', category: 'groceries', monthly_amount: 300 }),
    }), env);

    const delReq = makeRequest('http://test/api/category-budgets', {
      method: 'POST', body: JSON.stringify({ household_id: 'house-1', category: 'groceries', monthly_amount: null }),
    });
    const delRes = await runHandler(onRequestPost, delReq, env);
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json();
    expect(delBody.deleted).toBe(true);

    const getRes = await runHandler(onRequestGet, makeRequest('http://test/api/category-budgets?householdId=house-1'), env);
    const getBody = await getRes.json();
    expect(getBody.budgets).toHaveLength(0);
  });

  it('DELETE /api/category-budgets/[id] removes a budget by id or category', async () => {
    const { onRequestGet, onRequestPost } = await import('../functions/api/category-budgets');
    const { onRequestDelete } = await import('../functions/api/category-budgets/[id]');
    await runHandler(onRequestPost, makeRequest('http://test/api/category-budgets', {
      method: 'POST', body: JSON.stringify({ household_id: 'house-1', category: 'groceries', monthly_amount: 300 }),
    }), env);

    const delRes = await runHandler(onRequestDelete, makeRequest('http://test/api/category-budgets/groceries?householdId=house-1', { method: 'DELETE' }), env, { id: 'groceries' });
    expect(delRes.status).toBe(200);

    const getRes = await runHandler(onRequestGet, makeRequest('http://test/api/category-budgets?householdId=house-1'), env);
    expect((await getRes.json()).budgets).toHaveLength(0);
  });

  it('rejects setting a budget for the settlement category', async () => {
    const { onRequestPost } = await import('../functions/api/category-budgets');
    const req = makeRequest('http://test/api/category-budgets', {
      method: 'POST',
      body: JSON.stringify({ household_id: 'house-1', category: 'settlement', monthly_amount: 500 }),
    });
    const res = await runHandler(onRequestPost, req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('settlement');
  });

  it('enforces household membership checks', async () => {
    const { onRequestGet } = await import('../functions/api/category-budgets');
    const req = makeRequest('http://test/api/category-budgets?householdId=house-1', {}, 'unauthorized-user');
    await expect(runHandler(onRequestGet, req, env)).rejects.toThrow('Forbidden');
  });
});
