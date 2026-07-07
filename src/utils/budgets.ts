import type { CategoryBudget, Expense } from '../types';

export const BUDGETABLE_CATEGORIES = ['groceries', 'rent', 'household', 'leisure', 'sonstiges'] as const;
export type BudgetableCategory = typeof BUDGETABLE_CATEGORIES[number];

export function isBudgetableCategory(category: string | null | undefined): category is BudgetableCategory {
  return !!category && (BUDGETABLE_CATEGORIES as readonly string[]).includes(category);
}

export function startOfThisMonth(now: Date = new Date()): number {
  const d = new Date(now);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export function endOfThisMonth(now: Date = new Date()): number {
  const d = new Date(now);
  d.setMonth(d.getMonth() + 1, 1);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export function monthlySpentByCategory(
  expenses: Expense[],
  now: Date = new Date()
): Record<string, number> {
  const start = startOfThisMonth(now);
  const end = endOfThisMonth(now);
  const totals: Record<string, number> = {};
  for (const e of expenses) {
    const category = e.category || 'sonstiges';
    if (!isBudgetableCategory(category)) continue;
    const created = Number(e.created_at) || 0;
    if (created < start || created >= end) continue;
    totals[category] = (totals[category] || 0) + (Number(e.amount) || 0);
  }
  return totals;
}

export interface BudgetProgressLine {
  category: BudgetableCategory;
  monthlyAmount: number;
  spent: number;
  ratio: number;
  status: 'success' | 'warning' | 'danger';
}

export function budgetProgressLines(
  budgets: CategoryBudget[],
  expenses: Expense[],
  now: Date = new Date()
): BudgetProgressLine[] {
  const spent = monthlySpentByCategory(expenses, now);
  return budgets
    .filter(b => isBudgetableCategory(b.category) && Number(b.monthly_amount) > 0)
    .map(b => {
      const category = b.category as BudgetableCategory;
      const monthlyAmount = Number(b.monthly_amount) || 0;
      const categorySpent = spent[category] || 0;
      const ratio = monthlyAmount > 0 ? categorySpent / monthlyAmount : 0;
      const status: BudgetProgressLine['status'] = ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warning' : 'success';
      return {
        category,
        monthlyAmount,
        spent: categorySpent,
        ratio,
        status,
      };
    })
    .sort((a, b) => b.ratio - a.ratio);
}
