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

describe('CORS Middleware', () => {
  it('responds to OPTIONS with 204 and CORS headers', async () => {
    const { onRequest } = await import('../functions/_middleware');
    const env = { DB: createMockD1() } as unknown as Env;
    const request = makeRequest('http://test/api/households', { method: 'OPTIONS' });
    const response = await runHandler(onRequest, request, env);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://test');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });
});

describe('Households API', () => {
  let env: Env;

  beforeEach(() => {
    env = { DB: createMockD1() } as unknown as Env;
  });

  it('GET /api/households returns empty list for new user', async () => {
    const { onRequestGet } = await import('../functions/api/households');
    const request = makeRequest('http://test/api/households');
    const response = await runHandler(onRequestGet, request, env);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.households).toEqual([]);
  });

  it('POST /api/households creates a household', async () => {
    const { onRequestPost } = await import('../functions/api/households');
    const request = makeRequest('http://test/api/households', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test WG' }),
    });
    const response = await runHandler(onRequestPost, request, env);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.household).toBeDefined();
    expect(body.household.name).toBe('Test WG');
    expect(body.household.invite_code).toBeDefined();
    expect(body.household.invite_code).toHaveLength(8);
  });

  it('POST /api/households join requires a valid code', async () => {
    const { onRequestPost } = await import('../functions/api/households');
    const request = makeRequest('http://test/api/households', {
      method: 'POST',
      body: JSON.stringify({ action: 'join', code: 'INVALID' }),
    });
    const response = await runHandler(onRequestPost, request, env);
    expect(response.status).toBe(404);
  });

  it('POST /api/households rejects empty name', async () => {
    const { onRequestPost } = await import('../functions/api/households');
    const request = makeRequest('http://test/api/households', {
      method: 'POST',
      body: JSON.stringify({ name: '  ' }),
    });
    const response = await runHandler(onRequestPost, request, env);
    expect(response.status).toBe(400);
  });
});

describe('Items API', () => {
  let env: Env;
  let d1: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    d1 = createMockD1();
    d1.seedMembership('house-1', 'test-user');
    env = { DB: d1 } as unknown as Env;
  });

  it('GET /api/items requires householdId', async () => {
    const { onRequestGet } = await import('../functions/api/items');
    const request = makeRequest('http://test/api/items');
    const response = await runHandler(onRequestGet, request, env);
    expect(response.status).toBe(401);
  });

  it('POST /api/items creates an item', async () => {
    const { onRequestPost } = await import('../functions/api/items');
    const request = makeRequest('http://test/api/items', {
      method: 'POST',
      body: JSON.stringify({
        household_id: 'house-1',
        name: 'Milk',
        category: 'milch',
        threshold: 2,
      }),
    });
    const response = await runHandler(onRequestPost, request, env);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.item.name).toBe('Milk');
    expect(body.item.category).toBe('milch');
  });
});

describe('Tasks API', () => {
  let env: Env;
  let d1: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    d1 = createMockD1();
    d1.seedMembership('house-1', 'test-user');
    env = { DB: d1 } as unknown as Env;
  });

  it('POST /api/tasks creates a task', async () => {
    const { onRequestPost } = await import('../functions/api/tasks');
    const request = makeRequest('http://test/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        household_id: 'house-1',
        title: 'Clean kitchen',
        status: 'todo',
      }),
    });
    const response = await runHandler(onRequestPost, request, env);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.task.title).toBe('Clean kitchen');
    expect(body.task.status).toBe('todo');
  });
});

describe('Expenses API', () => {
  let env: Env;
  let d1: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    d1 = createMockD1();
    d1.seedMembership('house-1', 'test-user');
    env = { DB: d1 } as unknown as Env;
  });

  it('POST /api/expenses creates an expense', async () => {
    const { onRequestPost } = await import('../functions/api/expenses');
    const request = makeRequest('http://test/api/expenses', {
      method: 'POST',
      body: JSON.stringify({
        household_id: 'house-1',
        title: 'Groceries',
        amount: 42.5,
        paid_by: 'user-1',
        splits: [{ user_id: 'user-1', amount: 21.25 }, { user_id: 'user-2', amount: 21.25 }],
      }),
    });
    const response = await runHandler(onRequestPost, request, env);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.expense.title).toBe('Groceries');
    expect(body.expense.amount).toBe(42.5);
  });


  it('GET /api/expenses selects role and joined_at for members', async () => {
    const source = await (await import('node:fs/promises')).readFile('functions/api/expenses.ts', 'utf-8');
    const membersQueryMatch = source.match(/const members[\s\S]*?all\(\);/);
    expect(membersQueryMatch).toBeTruthy();
    expect(membersQueryMatch![0]).toMatch(/hm\.role/);
    expect(membersQueryMatch![0]).toMatch(/hm\.joined_at/);
  });

  // Regression test: onRequestPost used to respond with `{ id, ...body }`
  // instead of re-selecting the inserted row, so server-assigned defaults
  // never present in the request body (created_at) came back undefined.
  // src/views/expenses.ts renders `new Date(e.created_at).toLocaleDateString(...)`,
  // which showed "Invalid Date" immediately after creating an expense until
  // the next background sync poll re-fetched the real row. Caught via a
  // Playwright UI audit, not by inspecting the code directly.
  it('POST /api/expenses response includes a real created_at (not echoed from the request body)', async () => {
    const { onRequestPost } = await import('../functions/api/expenses');
    const request = makeRequest('http://test/api/expenses', {
      method: 'POST',
      body: JSON.stringify({ household_id: 'house-1', title: 'Rent', amount: 500, paid_by: 'test-user' }),
    });
    const response = await runHandler(onRequestPost, request, env);
    const body = await response.json();
    expect(typeof body.expense.created_at).toBe('number');
    expect(Number.isNaN(new Date(body.expense.created_at * 1000).getTime())).toBe(false);
  });
});

describe('Shopping API', () => {
  let env: Env;
  let d1: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    d1 = createMockD1();
    d1.seedMembership('house-1', 'test-user');
    env = { DB: d1 } as unknown as Env;
  });

  it('POST /api/shopping creates a shopping item', async () => {
    const { onRequestPost } = await import('../functions/api/shopping');
    const request = makeRequest('http://test/api/shopping', {
      method: 'POST',
      body: JSON.stringify({
        household_id: 'house-1',
        name: 'Bread',
        quantity: '2 loaves',
      }),
    });
    const response = await runHandler(onRequestPost, request, env);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.item.name).toBe('Bread');
    expect(body.item.quantity).toBe('2 loaves');
  });
});

describe('Batches API', () => {
  let env: Env;
  let d1: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    d1 = createMockD1();
    d1.seedMembership('house-1', 'test-user');
    d1.seedItem({ id: 'item-1', household_id: 'house-1', name: 'Test' });
    env = { DB: d1 } as unknown as Env;
  });

  it('POST /api/batches creates a batch', async () => {
    const { onRequestPost } = await import('../functions/api/batches');
    const request = makeRequest('http://test/api/batches', {
      method: 'POST',
      body: JSON.stringify({
        item_id: 'item-1',
        quantity: 5,
        expiry: '2026-12-31',
      }),
    });
    const response = await runHandler(onRequestPost, request, env);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.batch.quantity).toBe(5);
  });
});


describe('Category Budgets API', () => {
  let env: Env;
  let d1: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    d1 = createMockD1();
    d1.seedMembership('house-1', 'test-user');
    env = { DB: d1 } as unknown as Env;
  });

  it('POST /api/category-budgets upserts a household category budget', async () => {
    const { onRequestPost, onRequestGet } = await import('../functions/api/category-budgets');
    const createReq = makeRequest('http://test/api/category-budgets', {
      method: 'POST',
      body: JSON.stringify({ household_id: 'house-1', category: 'groceries', monthly_amount: 300 }),
    });
    const createRes = await runHandler(onRequestPost, createReq, env);
    expect(createRes.status).toBe(201);
    expect((await createRes.json()).budget.monthly_amount).toBe(300);

    const updateReq = makeRequest('http://test/api/category-budgets', {
      method: 'POST',
      body: JSON.stringify({ household_id: 'house-1', category: 'groceries', monthly_amount: 350 }),
    });
    const updateRes = await runHandler(onRequestPost, updateReq, env);
    expect(updateRes.status).toBe(200);

    const listReq = makeRequest('http://test/api/category-budgets?householdId=house-1');
    const listRes = await runHandler(onRequestGet, listReq, env);
    const body = await listRes.json();
    expect(body.budgets).toHaveLength(1);
    expect(body.budgets[0].monthly_amount).toBe(350);
  });

  it('rejects settlement as a budget category', async () => {
    const { onRequestPost } = await import('../functions/api/category-budgets');
    const request = makeRequest('http://test/api/category-budgets', {
      method: 'POST',
      body: JSON.stringify({ household_id: 'house-1', category: 'settlement', monthly_amount: 100 }),
    });
    const response = await runHandler(onRequestPost, request, env);
    expect(response.status).toBe(400);
  });

  it('DELETE /api/category-budgets removes a budget by household and category', async () => {
    const { onRequestPost, onRequestDelete, onRequestGet } = await import('../functions/api/category-budgets');
    await runHandler(onRequestPost, makeRequest('http://test/api/category-budgets', {
      method: 'POST',
      body: JSON.stringify({ household_id: 'house-1', category: 'rent', monthly_amount: 1000 }),
    }), env);
    const delRes = await runHandler(onRequestDelete, makeRequest('http://test/api/category-budgets?householdId=house-1&category=rent', { method: 'DELETE' }), env);
    expect(delRes.status).toBe(200);
    const listRes = await runHandler(onRequestGet, makeRequest('http://test/api/category-budgets?householdId=house-1'), env);
    expect((await listRes.json()).budgets).toEqual([]);
  });
});

describe('Route Params Handlers', () => {
  let env: Env;
  let d1: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    d1 = createMockD1();
    d1.seedMembership('h1', 'test-user');
    env = { DB: d1 } as unknown as Env;
  });

  it('PATCH /api/households/:id regenerates invite code', async () => {
    const { onRequestPatch } = await import('../functions/api/households/[id]');
    const request = makeRequest('http://test/api/households/h1', {
      method: 'PATCH',
      body: JSON.stringify({ invite_code: 'regenerate' }),
    });
    const response = await runHandler(onRequestPatch, request, env, { id: 'h1' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.invite_code).toBeDefined();
    expect(body.invite_code).toHaveLength(8);
  });

  it('PATCH /api/items/:id updates an item', async () => {
    d1.seedItem({ id: 'i1', household_id: 'h1', name: 'Test', threshold: 2 });
    const { onRequestPatch } = await import('../functions/api/items/[id]');
    const request = makeRequest('http://test/api/items/i1', {
      method: 'PATCH',
      body: JSON.stringify({ threshold: 10 }),
    });
    const response = await runHandler(onRequestPatch, request, env, { id: 'i1' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.item.threshold).toBe(10);
  });

  it('DELETE /api/tasks/:id deletes a task', async () => {
    d1.seed('tasks', [{ id: 't1', household_id: 'h1', title: 'Task' }]);
    const { onRequestDelete } = await import('../functions/api/tasks/[id]');
    const request = makeRequest('http://test/api/tasks/t1', { method: 'DELETE' });
    const response = await runHandler(onRequestDelete, request, env, { id: 't1' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });
});
