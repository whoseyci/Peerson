import type { Expense, ExpenseSplit, HouseholdMember } from '../types';

export interface PersonalBalanceLine {
  memberId: string;
  memberName: string;
  amount: number;
  direction: 'you_owe' | 'owes_you';
}

export function personalBalanceLines(
  userId: string,
  members: HouseholdMember[],
  expenses: Expense[],
  splits: ExpenseSplit[]
): PersonalBalanceLine[] {
  if (!userId) return [];

  const byMember = new Map(members.map(m => [m.id, m]));
  const netByOther = new Map<string, number>();

  for (const expense of expenses) {
    const expenseSplits = splits.filter(sp => sp.expense_id === expense.id);
    for (const split of expenseSplits) {
      const amount = Number(split.amount) || 0;
      if (amount <= 0) continue;

      if (expense.paid_by === userId && split.user_id !== userId) {
        netByOther.set(split.user_id, (netByOther.get(split.user_id) || 0) + amount);
      } else if (expense.paid_by !== userId && split.user_id === userId) {
        netByOther.set(expense.paid_by, (netByOther.get(expense.paid_by) || 0) - amount);
      }
    }
  }

  return Array.from(netByOther.entries())
    .filter(([, net]) => Math.abs(net) > 0.05)
    .map(([memberId, net]) => ({
      memberId,
      memberName: byMember.get(memberId)?.name || 'Unbekannt',
      amount: Math.abs(net),
      direction: (net < 0 ? 'you_owe' : 'owes_you') as PersonalBalanceLine['direction'], 
    }))
    .sort((a, b) => b.amount - a.amount);
}

// Every member's overall net balance across the whole household (positive =
// the household owes them, negative = they owe the household) -- not
// relative to any one viewer. Used by the People view's "who owes whom"
// balance bar, which needs to show all members side by side rather than
// just "you vs. everyone else" the way personalBalanceLines() does.
export interface MemberBalance {
  memberId: string;
  memberName: string;
  balance: number;
}

export function allMemberBalances(
  members: HouseholdMember[],
  expenses: Expense[],
  splits: ExpenseSplit[]
): MemberBalance[] {
  const balances = new Map(members.map(m => [m.id, 0]));
  for (const expense of expenses) {
    if (balances.has(expense.paid_by)) {
      balances.set(expense.paid_by, (balances.get(expense.paid_by) || 0) + expense.amount);
    }
  }
  for (const split of splits) {
    if (balances.has(split.user_id)) {
      balances.set(split.user_id, (balances.get(split.user_id) || 0) - (Number(split.amount) || 0));
    }
  }
  return members.map(m => ({
    memberId: m.id,
    memberName: m.name,
    balance: balances.get(m.id) || 0,
  }));
}

