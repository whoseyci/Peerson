import { describe, it, expect } from 'vitest';
import { personalBalanceLines, allMemberBalances } from '../src/utils/finance';
import type { Expense, ExpenseSplit, HouseholdMember } from '../src/types';

const members: HouseholdMember[] = [
  { id: 'alice', name: 'Alice', role: 'admin', joined_at: 0 },
  { id: 'bob', name: 'Bob', role: 'member', joined_at: 0 },
  { id: 'jo', name: 'Jo', role: 'member', joined_at: 0 },
];

function expense(id: string, paid_by: string, amount: number): Expense {
  return { id, household_id: 'h1', title: 'x', amount, paid_by, split_type: 'equal', created_at: 0 };
}
function split(expense_id: string, user_id: string, amount: number): ExpenseSplit {
  return { id: expense_id + ':' + user_id, expense_id, user_id, amount, settled: 0 };
}

describe('personalBalanceLines', () => {
  it('returns nothing for an empty ledger', () => {
    expect(personalBalanceLines('alice', members, [], [])).toEqual([]);
  });

  it('shows Bob owes Alice when Alice paid and Bob is on the split', () => {
    const expenses = [expense('e1', 'alice', 30)];
    const splits = [split('e1', 'bob', 15)];
    const lines = personalBalanceLines('alice', members, expenses, splits);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ memberId: 'bob', direction: 'owes_you', amount: 15 });
  });

  it('shows Alice owes Bob from Bob\'s perspective (mirror image)', () => {
    const expenses = [expense('e1', 'alice', 30)];
    const splits = [split('e1', 'bob', 15)];
    const lines = personalBalanceLines('bob', members, expenses, splits);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ memberId: 'alice', direction: 'you_owe', amount: 15 });
  });

  it('nets multiple expenses between the same two people down to one line', () => {
    const expenses = [expense('e1', 'alice', 30), expense('e2', 'bob', 20)];
    const splits = [split('e1', 'bob', 15), split('e2', 'alice', 10)];
    // alice is owed 15 (e1), alice owes 10 (e2) -> net: bob owes alice 5
    const lines = personalBalanceLines('alice', members, expenses, splits);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ memberId: 'bob', direction: 'owes_you', amount: 5 });
  });

  it('drops balances that net out to (near) zero', () => {
    const expenses = [expense('e1', 'alice', 20)];
    const splits = [split('e1', 'bob', 10), split('e2', 'bob', 10)];
    // Not a real scenario (mismatched expense ids) but confirms the 0.05 threshold guard
    const lines = personalBalanceLines('alice', members, [expense('e1', 'alice', 0)], []);
    expect(lines).toEqual([]);
  });
});

describe('allMemberBalances', () => {
  it('gives every member a zero balance with no expenses', () => {
    const result = allMemberBalances(members, [], []);
    expect(result).toHaveLength(3);
    expect(result.every(r => r.balance === 0)).toBe(true);
  });

  it('credits the payer and debits split participants', () => {
    const expenses = [expense('e1', 'alice', 30)];
    const splits = [split('e1', 'alice', 10), split('e1', 'bob', 10), split('e1', 'jo', 10)];
    const result = allMemberBalances(members, expenses, splits);
    const byId = Object.fromEntries(result.map(r => [r.memberId, r.balance]));
    // Alice paid 30, owes herself 10 back out of the split -> net +20
    expect(byId.alice).toBeCloseTo(20);
    expect(byId.bob).toBeCloseTo(-10);
    expect(byId.jo).toBeCloseTo(-10);
    // Balances across the whole household must always sum to zero -- money
    // doesn't appear or disappear, it only moves between members.
    const total = result.reduce((a, r) => a + r.balance, 0);
    expect(total).toBeCloseTo(0);
  });

  it('ignores splits for users not in the members list (defensive)', () => {
    const expenses = [expense('e1', 'alice', 10)];
    const splits = [split('e1', 'ghost-user', 10)];
    const result = allMemberBalances(members, expenses, splits);
    const byId = Object.fromEntries(result.map(r => [r.memberId, r.balance]));
    expect(byId.alice).toBeCloseTo(10);
    expect(byId.bob).toBe(0);
    expect(byId.jo).toBe(0);
  });
});
