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
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
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
