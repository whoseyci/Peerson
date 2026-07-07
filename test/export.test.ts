import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1 } from './mocks/d1';
import type { Env } from '../functions/_middleware';

function makeRequest(url: string, opts: RequestInit = {}, userId = 'test-user'): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };
  if (userId) headers['X-User-Id'] = userId;
  return new Request(url, { ...opts, headers });
}

async function runHandler(handler: any, request: Request, env: Env) {
  return handler({ request, env } as any);
}

describe('Export API', () => {
  let env: Env;
  let d1: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    d1 = createMockD1();
    env = { DB: d1 } as unknown as Env;
  });

  it('GET /api/export requires authentication', async () => {
    const { onRequestGet } = await import('../functions/api/export');
    const request = new Request('http://test/api/export?householdId=house-1');
    const response = await runHandler(onRequestGet, request, env);
    expect(response.status).toBe(401);
  });

  it('GET /api/export requires householdId parameter', async () => {
    const { onRequestGet } = await import('../functions/api/export');
    const request = makeRequest('http://test/api/export');
    const response = await runHandler(onRequestGet, request, env);
    expect(response.status).toBe(400);
  });

  it('GET /api/export returns 403 for a non-member', async () => {
    const { onRequestGet } = await import('../functions/api/export');
    d1.seedMembership('house-1', 'member-user');
    const request = makeRequest('http://test/api/export?householdId=house-1', {}, 'stranger-user');
    const response = await runHandler(onRequestGet, request, env);
    expect(response.status).toBe(403);
  });

  it('GET /api/export returns all expected resource types correctly scoped and isolated', async () => {
    const { onRequestGet } = await import('../functions/api/export');
    d1.seedMembership('house-A', 'user-A');
    d1.seedMembership('house-B', 'user-B');

    // Seed users
    await d1.prepare("INSERT INTO users (id, name) VALUES (?, ?)").bind('user-A', 'Alice').run();
    await d1.prepare("INSERT INTO users (id, name) VALUES (?, ?)").bind('user-B', 'Bob').run();

    // Seed Household A data
    await d1.prepare("INSERT INTO households (id, name) VALUES (?, ?)").bind('house-A', 'WG Alpha').run();
    await d1.prepare("INSERT INTO items (id, household_id, name, category, barcodes) VALUES (?, ?, ?, ?, ?)").bind('item-A', 'house-A', 'Milk', 'milch', '["12345"]').run();
    await d1.prepare("INSERT INTO batches (id, item_id, quantity) VALUES (?, ?, ?)").bind('batch-A', 'item-A', 2).run();
    await d1.prepare("INSERT INTO item_price_history (id, item_id, price_cents) VALUES (?, ?, ?)").bind('ph-A', 'item-A', 150).run();
    await d1.prepare("INSERT INTO tasks (id, household_id, title, status) VALUES (?, ?, ?, ?)").bind('task-A', 'house-A', 'Clean Kitchen', 'todo').run();
    await d1.prepare("INSERT INTO task_completions (id, task_id, household_id, completed_by) VALUES (?, ?, ?, ?)").bind('tc-A', 'task-A', 'house-A', 'user-A').run();
    await d1.prepare("INSERT INTO expenses (id, household_id, title, amount, paid_by) VALUES (?, ?, ?, ?, ?)").bind('exp-A', 'house-A', 'Groceries', 20, 'user-A').run();
    await d1.prepare("INSERT INTO expense_splits (id, expense_id, user_id, amount) VALUES (?, ?, ?, ?)").bind('sp-A', 'exp-A', 'user-A', 20).run();
    await d1.prepare("INSERT INTO shopping_items (id, household_id, name) VALUES (?, ?, ?)").bind('shop-A', 'house-A', 'Bread').run();
    await d1.prepare("INSERT INTO locations (id, household_id, name) VALUES (?, ?, ?)").bind('loc-A', 'house-A', 'Pantry').run();
    await d1.prepare("INSERT INTO category_budgets (id, household_id, category, monthly_amount) VALUES (?, ?, ?, ?)").bind('bud-A', 'house-A', 'groceries', 300).run();

    // Seed Household B data (must NOT leak!)
    await d1.prepare("INSERT INTO households (id, name) VALUES (?, ?)").bind('house-B', 'WG Beta').run();
    await d1.prepare("INSERT INTO items (id, household_id, name, category) VALUES (?, ?, ?, ?)").bind('item-B', 'house-B', 'Secret Beer', 'leisure').run();
    await d1.prepare("INSERT INTO batches (id, item_id, quantity) VALUES (?, ?, ?)").bind('batch-B', 'item-B', 10).run();
    await d1.prepare("INSERT INTO tasks (id, household_id, title) VALUES (?, ?, ?)").bind('task-B', 'house-B', 'Secret Task').run();
    await d1.prepare("INSERT INTO expenses (id, household_id, title, amount, paid_by) VALUES (?, ?, ?, ?, ?)").bind('exp-B', 'house-B', 'Party', 100, 'user-B').run();
    await d1.prepare("INSERT INTO shopping_items (id, household_id, name) VALUES (?, ?, ?)").bind('shop-B', 'house-B', 'Secret Chips').run();
    await d1.prepare("INSERT INTO locations (id, household_id, name) VALUES (?, ?, ?)").bind('loc-B', 'house-B', 'Secret Cellar').run();

    const request = makeRequest('http://test/api/export?householdId=house-A', {}, 'user-A');
    const response = await runHandler(onRequestGet, request, env);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.household).toBeDefined();
    expect(body.household.id).toBe('house-A');
    expect(body.household.name).toBe('WG Alpha');

    expect(Array.isArray(body.members)).toBe(true);
    expect(body.members.some((m: any) => m.id === 'user-A')).toBe(true);
    expect(body.members.some((m: any) => m.id === 'user-B')).toBe(false);

    expect(body.items.length).toBe(1);
    expect(body.items[0].name).toBe('Milk');
    expect(body.items[0].barcodes).toEqual(['12345']); // verifies JSON parsing!

    expect(body.batches.length).toBe(1);
    expect(body.batches[0].id).toBe('batch-A');

    expect(body.priceHistory.length).toBe(1);
    expect(body.priceHistory[0].id).toBe('ph-A');

    expect(body.tasks.length).toBe(1);
    expect(body.tasks[0].title).toBe('Clean Kitchen');

    expect(body.taskCompletions.length).toBe(1);
    expect(body.taskCompletions[0].id).toBe('tc-A');

    expect(body.expenses.length).toBe(1);
    expect(body.expenses[0].title).toBe('Groceries');

    expect(body.expenseSplits.length).toBe(1);
    expect(body.expenseSplits[0].id).toBe('sp-A');

    expect(body.shoppingItems.length).toBe(1);
    expect(body.shoppingItems[0].name).toBe('Bread');

    expect(body.locations.length).toBe(1);
    expect(body.locations[0].name).toBe('Pantry');

    expect(body.categoryBudgets.length).toBe(1);
    expect(body.categoryBudgets[0].category).toBe('groceries');
  });
});
