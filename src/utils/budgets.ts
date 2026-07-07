import type { CategoryBudget, Expense } from '../types';

export const BUDGETABLE_CATEGORIES = ['groceries', 'rent', 'household', 'leisure', 'sonstiges'] as const;
export type BudgetableCategory = typeof BUDGETABLE_CATEGORIES[number];

export function isBudgetableCategory(category: string | null | undefined): category is BudgetableCategory {
  return !!category && (BUDGETABLE_CATEGORIES as readonly string[]).includes(category);
}

// German display labels for budgetable categories -- kept here (rather than
// only in src/views/expenses.ts's icon+label EXPENSE_CATEGORIES map) so
// non-view code like src/utils/feed.ts's Home-feed budget-warning cards can
// show a real label instead of a raw category slug, without depending on a
// views/ module or duplicating this list a third time.
export const BUDGET_CATEGORY_LABELS: Record<BudgetableCategory, string> = {
  groceries: 'Lebensmittel',
  rent: 'Miete & Wohnen',
  household: 'Haushalt & Drogerie',
  leisure: 'Freizeit',
  sonstiges: 'Sonstiges',
};

// Strips the leading "💸 " prefix some settlement-title strings carry (see
// executeSettlement() in src/views/expenses.ts, which prefixes settlement
// titles this way) before doing any text matching against a title.
export function cleanExpenseTitle(title: string): string {
  return (title || '').replace(/^\s*\u{1F4B8}\s*/u, '').trim();
}

// True for anything that's really a debt-settlement transfer between two
// members rather than real household spending -- either because it was
// created with category 'settlement' (the normal path, via
// executeSettlement()) or because its title reads like one even if the
// category doesn't say so (e.g. a manually-edited expense). Shared between
// src/views/expenses.ts (which uses it to keep settlements out of the
// regular expense list/history) and this module's own monthly-spend
// aggregation, so a settlement can never accidentally count against a
// category budget no matter which path created it.
export function isSettlementExpense(expense: Pick<Expense, 'title' | 'category'>): boolean {
  const title = cleanExpenseTitle(expense.title || '').toLowerCase();
  return expense.category === 'settlement' || title.includes('schuldenausgleich') || title.includes('ausgleich') || title.includes('settlement');
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
    // Belt-and-braces: category === 'settlement' already gets filtered out
    // below by isBudgetableCategory, but a settlement-like *title* under a
    // different/missing category (e.g. hand-edited) shouldn't silently
    // count against that category's budget either.
    if (isSettlementExpense(e)) continue;
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
