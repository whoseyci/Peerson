import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1 } from './mocks/d1';
import type { Env } from '../functions/_middleware';
import { allMemberBalances } from '../src/utils/finance';
import type { Expense, ExpenseSplit, HouseholdMember } from '../src/types';

function makeRequest(url: string, opts: RequestInit = {}, userId = 'alice'): Request {
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

describe('GDPR data export endpoint', () => {
  let env: Env;
  let d1: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    d1 = createMockD1();
    env = { DB: d1 } as unknown as Env;
    d1.seed('households', [
      { id: 'h1', name: 'Main WG', invite_code: 'ABCDEFGH', created_at: 1 },
      { id: 'h2', name: 'Other WG', invite_code: 'ZZZZZZZZ', created_at: 2 },
    ]);
    d1.seed('users', [
      { id: 'alice', name: 'Alice', created_at: 1 },
      { id: 'bob', name: 'Bob', created_at: 1 },
      { id: 'mallory', name: 'Mallory', created_at: 1 },
    ]);
    d1.seed('household_members', [
      { household_id: 'h1', user_id: 'alice', role: 'admin', joined_at: 1 },
      { household_id: 'h1', user_id: 'bob', role: 'member', joined_at: 2 },
      { household_id: 'h2', user_id: 'mallory', role: 'admin', joined_at: 3 },
    ]);
    d1.seed('items', [
      { id: 'item-1', household_id: 'h1', name: 'Milk', created_at: 10 },
      { id: 'item-2', household_id: 'h2', name: 'Secret', created_at: 11 },
    ]);
    d1.seed('batches', [
      { id: 'batch-1', item_id: 'item-1', quantity: 2, date_added: 10 },
      { id: 'batch-2', item_id: 'item-2', quantity: 9, date_added: 11 },
    ]);
    d1.seed('item_price_history', [
      { id: 'price-1', item_id: 'item-1', price_cents: 129, effective_from: 10 },
      { id: 'price-2', item_id: 'item-2', price_cents: 999, effective_from: 11 },
    ]);
    d1.seed('tasks', [
      { id: 'task-1', household_id: 'h1', title: 'Clean', created_at: 10 },
      { id: 'task-2', household_id: 'h2', title: 'Hide', created_at: 11 },
    ]);
    d1.seed('task_completions', [
      { id: 'tc-1', task_id: 'task-1', household_id: 'h1', completed_by: 'alice', completed_at: 12 },
      { id: 'tc-2', task_id: 'task-2', household_id: 'h2', completed_by: 'mallory', completed_at: 13 },
    ]);
    d1.seed('expenses', [
      { id: 'expense-1', household_id: 'h1', title: 'Rent', amount: 100, paid_by: 'alice', created_at: 10 },
      { id: 'expense-2', household_id: 'h2', title: 'Other', amount: 200, paid_by: 'mallory', created_at: 11 },
    ]);
    d1.seed('expense_splits', [
      { id: 'split-1', expense_id: 'expense-1', user_id: 'bob', amount: 50, settled: 0 },
      { id: 'split-2', expense_id: 'expense-2', user_id: 'mallory', amount: 200, settled: 0 },
    ]);
    d1.seed('shopping_items', [
      { id: 'shop-1', household_id: 'h1', name: 'Bread', created_at: 10 },
      { id: 'shop-2', household_id: 'h2', name: 'Leaks', created_at: 11 },
    ]);
    d1.seed('locations', [
      { id: 'loc-1', household_id: 'h1', name: 'Kitchen', sort_order: 0 },
      { id: 'loc-2', household_id: 'h2', name: 'Vault', sort_order: 0 },
    ]);
    d1.seed('category_budgets', [
      { id: 'budget-1', household_id: 'h1', category: 'food', monthly_amount: 250 },
      { id: 'budget-2', household_id: 'h2', category: 'secrets', monthly_amount: 999 },
    ]);
  });

  it('returns every expected resource type scoped to the requested household', async () => {
    const { onRequestGet } = await import('../functions/api/export');
    const response = await runHandler(onRequestGet, makeRequest('http://test/api/export?householdId=h1'), env);
    expect(response.status).toBe(200);
    const body = await response.json() as any;

    expect(body.household.id).toBe('h1');
    expect(body).toMatchObject({
      exportedAt: expect.any(String),
      members: expect.any(Array),
      items: expect.any(Array),
      batches: expect.any(Array),
      priceHistory: expect.any(Array),
      tasks: expect.any(Array),
      taskCompletions: expect.any(Array),
      expenses: expect.any(Array),
      expenseSplits: expect.any(Array),
      shoppingItems: expect.any(Array),
      locations: expect.any(Array),
      categoryBudgets: expect.any(Array),
    });
    expect(body.members.map((m: any) => m.id).sort()).toEqual(['alice', 'bob']);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe('item-1');
    expect(body.batches.map((b: any) => b.id)).toEqual(['batch-1']);
    expect(body.priceHistory.map((p: any) => p.id)).toEqual(['price-1']);
    expect(body.tasks.map((t: any) => t.id)).toEqual(['task-1']);
    expect(body.taskCompletions.map((t: any) => t.id)).toEqual(['tc-1']);
    expect(body.expenses.map((e: any) => e.id)).toEqual(['expense-1']);
    expect(body.expenseSplits.map((s: any) => s.id)).toEqual(['split-1']);
    expect(body.shoppingItems.map((s: any) => s.id)).toEqual(['shop-1']);
    expect(body.locations.map((l: any) => l.id)).toEqual(['loc-1']);
    expect(body.categoryBudgets.map((b: any) => b.id)).toEqual(['budget-1']);

    expect(JSON.stringify(body)).not.toContain('h2');
    expect(JSON.stringify(body)).not.toContain('Secret');
    expect(JSON.stringify(body)).not.toContain('Mallory');
  });

  it('rejects missing users and non-members', async () => {
    const { onRequestGet } = await import('../functions/api/export');
    const missingUser = await runHandler(onRequestGet, new Request('http://test/api/export?householdId=h1'), env);
    expect(missingUser.status).toBe(401);

    const nonMember = await runHandler(onRequestGet, makeRequest('http://test/api/export?householdId=h1', {}, 'mallory'), env);
    expect(nonMember.status).toBe(403);
  });
});

describe('GDPR account deletion endpoint', () => {
  let env: Env;
  let d1: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    d1 = createMockD1();
    env = { DB: d1 } as unknown as Env;
    d1.seed('users', [
      { id: 'alice', name: 'Alice' },
      { id: 'bob', name: 'Bob' },
    ]);
    d1.seed('household_members', [
      { household_id: 'h1', user_id: 'alice', role: 'admin', joined_at: 1 },
      { household_id: 'h1', user_id: 'bob', role: 'member', joined_at: 1 },
      { household_id: 'h2', user_id: 'alice', role: 'member', joined_at: 1 },
    ]);
    d1.seed('expenses', [
      { id: 'e1', household_id: 'h1', title: 'Groceries', amount: 30, paid_by: 'alice', split_type: 'equal', created_at: 1 },
    ]);
    d1.seed('expense_splits', [
      { id: 's1', expense_id: 'e1', user_id: 'alice', amount: 15, settled: 0 },
      { id: 's2', expense_id: 'e1', user_id: 'bob', amount: 15, settled: 0 },
    ]);
  });

  it('anonymizes the current user and removes memberships from all households', async () => {
    const { onRequestPost } = await import('../functions/api/users');
    const response = await runHandler(onRequestPost, makeRequest('http://test/api/users', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_account' }),
    }, 'alice'), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, anonymized: true });

    const alice = await d1.prepare('SELECT * FROM users WHERE id = ?').bind('alice').first();
    expect(alice?.name).toBe('Gelöschter Nutzer');
    const memberships = await d1.prepare('SELECT * FROM household_members WHERE user_id = ?').bind('alice').all();
    expect(memberships.results).toEqual([]);
    const bobMembership = await d1.prepare('SELECT * FROM household_members WHERE user_id = ?').bind('bob').all();
    expect(bobMembership.results).toHaveLength(1);
  });

  it('rejects attempts to delete a different user', async () => {
    const { onRequestPost } = await import('../functions/api/users');
    const response = await runHandler(onRequestPost, makeRequest('http://test/api/users', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_account', target_user_id: 'bob' }),
    }, 'alice'), env);
    expect(response.status).toBe(403);
    const bob = await d1.prepare('SELECT * FROM users WHERE id = ?').bind('bob').first();
    expect(bob?.name).toBe('Bob');
  });

  it('keeps household balances internally consistent after an expense payer is deleted', async () => {
    const { onRequestPost } = await import('../functions/api/users');
    const { onRequestGet } = await import('../functions/api/expenses');

    await runHandler(onRequestPost, makeRequest('http://test/api/users', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_account' }),
    }, 'alice'), env);

    const response = await runHandler(onRequestGet, makeRequest('http://test/api/expenses?householdId=h1', {}, 'bob'), env);
    expect(response.status).toBe(200);
    const body = await response.json() as { members: HouseholdMember[]; expenses: Expense[]; splits: ExpenseSplit[] };
    expect(body.members.find(m => m.id === 'alice')).toMatchObject({ name: 'Gelöschter Nutzer', role: 'former' });

    const balances = allMemberBalances(body.members, body.expenses, body.splits);
    expect(balances.reduce((sum, b) => sum + b.balance, 0)).toBeCloseTo(0);
    const byId = Object.fromEntries(balances.map(b => [b.memberId, b.balance]));
    expect(byId.alice).toBeCloseTo(15);
    expect(byId.bob).toBeCloseTo(-15);
  });
});
