import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1 } from './mocks/d1';
import type { Env } from '../functions/_middleware';
import { personalBalanceLines, allMemberBalances } from '../src/utils/finance';

function makeRequest(url: string, opts: RequestInit = {}, userId = 'user-1'): Request {
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

describe('Account Deletion API', () => {
  let env: Env;
  let d1: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    d1 = createMockD1();
    env = { DB: d1 } as unknown as Env;
  });

  it('POST /api/users delete_account requires authentication', async () => {
    const { onRequestPost } = await import('../functions/api/users');
    const request = new Request('http://test/api/users', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_account' }),
    });
    const response = await runHandler(onRequestPost, request, env);
    expect(response.status).toBe(401);
  });

  it('POST /api/users delete_account rejects deleting another user', async () => {
    const { onRequestPost } = await import('../functions/api/users');
    d1.seedMembership('house-1', 'user-1');
    d1.seedMembership('house-1', 'user-2');
    
    // Attempting via target_user_id
    const req1 = makeRequest('http://test/api/users', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_account', target_user_id: 'user-2' }),
    }, 'user-1');
    const res1 = await runHandler(onRequestPost, req1, env);
    expect(res1.status).toBe(403);

    // Attempting via user_id
    const req2 = makeRequest('http://test/api/users', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_account', user_id: 'user-2' }),
    }, 'user-1');
    const res2 = await runHandler(onRequestPost, req2, env);
    expect(res2.status).toBe(403);
  });

  it('POST /api/users delete_account anonymizes user and removes from all households', async () => {
    const { onRequestPost } = await import('../functions/api/users');
    await d1.prepare("INSERT INTO users (id, name) VALUES (?, ?)").bind('user-1', 'Alice').run();
    d1.seedMembership('house-1', 'user-1');
    d1.seedMembership('house-2', 'user-1');

    const request = makeRequest('http://test/api/users', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_account' }),
    }, 'user-1');
    const response = await runHandler(onRequestPost, request, env);
    expect(response.status).toBe(200);

    // Check user row is anonymized
    const user = await d1.prepare("SELECT * FROM users WHERE id = ?").bind('user-1').first();
    expect(user).toBeDefined();
    expect(user.name).toBe('Gelöschter Nutzer');

    // Check removed from all households
    const memberships = await d1.prepare("SELECT * FROM household_members WHERE user_id = ?").bind('user-1').all();
    expect(memberships.results).toEqual([]);
  });

  it('proves household balances remain internally consistent after a member who paid for expenses is deleted', async () => {
    const { onRequestPost } = await import('../functions/api/users');

    // Setup 2 users in WG Alpha
    await d1.prepare("INSERT INTO users (id, name) VALUES (?, ?)").bind('user-1', 'Alice').run();
    await d1.prepare("INSERT INTO users (id, name) VALUES (?, ?)").bind('user-2', 'Bob').run();
    await d1.prepare("INSERT INTO households (id, name) VALUES (?, ?)").bind('house-1', 'WG Alpha').run();
    d1.seedMembership('house-1', 'user-1');
    d1.seedMembership('house-1', 'user-2');

    // Alice pays 10€ for Groceries, split equal (5€ Alice, 5€ Bob)
    await d1.prepare("INSERT INTO expenses (id, household_id, title, amount, paid_by) VALUES (?, ?, ?, ?, ?)").bind('exp-1', 'house-1', 'Groceries', 10, 'user-1').run();
    await d1.prepare("INSERT INTO expense_splits (id, expense_id, user_id, amount) VALUES (?, ?, ?, ?)").bind('sp-1', 'exp-1', 'user-1', 5).run();
    await d1.prepare("INSERT INTO expense_splits (id, expense_id, user_id, amount) VALUES (?, ?, ?, ?)").bind('sp-2', 'exp-1', 'user-2', 5).run();

    // Verify initial financial state
    const membersBefore = [
      { id: 'user-1', name: 'Alice', role: 'member' },
      { id: 'user-2', name: 'Bob', role: 'member' },
    ];
    const expenses = (await d1.prepare("SELECT * FROM expenses WHERE household_id = ?").bind('house-1').all()).results as any[];
    const splits = (await d1.prepare("SELECT * FROM expense_splits").all()).results as any[];

    const bobLinesBefore = personalBalanceLines('user-2', membersBefore, expenses, splits);
    expect(bobLinesBefore.length).toBe(1);
    expect(bobLinesBefore[0].memberId).toBe('user-1');
    expect(bobLinesBefore[0].amount).toBe(5);
    expect(bobLinesBefore[0].direction).toBe('you_owe');

    const allBefore = allMemberBalances(membersBefore, expenses, splits);
    expect(allBefore.find(m => m.memberId === 'user-1')?.balance).toBe(5);
    expect(allBefore.find(m => m.memberId === 'user-2')?.balance).toBe(-5);

    // Alice deletes her account (Option A: Anonymize, don't cascade delete)
    const delReq = makeRequest('http://test/api/users', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_account' }),
    }, 'user-1');
    const delRes = await runHandler(onRequestPost, delReq, env);
    expect(delRes.status).toBe(200);

    // Verify balances after Alice's deletion
    const activeMembersAfter = [
      { id: 'user-2', name: 'Bob', role: 'member' },
    ];
    const expensesAfter = (await d1.prepare("SELECT * FROM expenses WHERE household_id = ?").bind('house-1').all()).results as any[];
    const splitsAfter = (await d1.prepare("SELECT * FROM expense_splits").all()).results as any[];

    // Expenses and splits must NOT be deleted or corrupted
    expect(expensesAfter.length).toBe(1);
    expect(splitsAfter.length).toBe(2);

    // Bob's debt remains 5€ even if a caller only has active members locally.
    const bobLinesAfter = personalBalanceLines('user-2', activeMembersAfter, expensesAfter, splitsAfter);
    expect(bobLinesAfter.length).toBe(1);
    expect(bobLinesAfter[0].memberId).toBe('user-1');
    expect(bobLinesAfter[0].amount).toBe(5);
    expect(bobLinesAfter[0].direction).toBe('you_owe');
    expect(bobLinesAfter[0].memberName).toBe('Unbekannt'); // since user-1 is no longer in active members list

    // The expenses API should add anonymized former ledger participants back
    // into its returned members list, so the UI can show "Gelöschter Nutzer"
    // and all-member balance summaries still net to zero across the full ledger.
    const { onRequestGet: getExpenses } = await import('../functions/api/expenses');
    const expensesResponse = await runHandler(getExpenses, makeRequest('http://test/api/expenses?householdId=house-1', {}, 'user-2'), env);
    expect(expensesResponse.status).toBe(200);
    const expensesBody = await expensesResponse.json() as any;
    expect(expensesBody.members.find((m: any) => m.id === 'user-1')).toMatchObject({ name: 'Gelöschter Nutzer', role: 'former' });

    const allAfter = allMemberBalances(expensesBody.members, expensesBody.expenses, expensesBody.splits);
    expect(allAfter.find(m => m.memberId === 'user-1')?.balance).toBe(5);
    expect(allAfter.find(m => m.memberId === 'user-2')?.balance).toBe(-5);
    expect(allAfter.reduce((sum, m) => sum + m.balance, 0)).toBeCloseTo(0);
  });
});
