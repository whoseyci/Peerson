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
