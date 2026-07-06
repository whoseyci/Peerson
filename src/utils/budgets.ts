import type { Expense, CategoryBudget } from '../types';

// Start of the current calendar month (1st of month at 00:00:00.000 local time)
// as a unix timestamp in seconds.
export function startOfThisMonth(now: Date = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return Math.floor(d.getTime() / 1000);
}

export interface CategorySpendingSummary {
  category: string;
  spent: number;
  budgetAmount: number | null;
  percentageUsed: number | null;
}

// Computes current-month spending per category against configured category budgets.
// Excludes settlement expenses (e.g. category === 'settlement' or e.title containing 'Ausgleich' / 'Schuldenausgleich').
export function computeCategoryBudgets(
  expenses: Expense[],
  budgets: CategoryBudget[],
  now: Date = new Date()
): CategorySpendingSummary[] {
  const startTs = startOfThisMonth(now);
  const spentByCat = new Map<string, number>();

  for (const e of expenses) {
    if (e.created_at < startTs) continue;
    // Exclude settlement expenses from budgeting entirely
    if (e.category === 'settlement' || (e.title && (e.title.toLowerCase().includes('ausgleich') || e.title.toLowerCase().includes('settlement')))) {
      continue;
    }
    const cat = e.category || 'sonstiges';
    spentByCat.set(cat, (spentByCat.get(cat) || 0) + e.amount);
  }

  // All known non-settlement categories
  const allCats = new Set<string>(['groceries', 'rent', 'household', 'leisure', 'sonstiges']);
  for (const b of budgets) {
    if (b.category && b.category !== 'settlement') allCats.add(b.category);
  }
  for (const cat of spentByCat.keys()) {
    if (cat !== 'settlement') allCats.add(cat);
  }

  const results: CategorySpendingSummary[] = [];
  for (const cat of allCats) {
    const spent = spentByCat.get(cat) || 0;
    const bRow = budgets.find(b => b.category === cat);
    const budgetAmount = (bRow && bRow.monthly_amount > 0) ? bRow.monthly_amount : null;
    const percentageUsed = budgetAmount !== null ? Math.round((spent / budgetAmount) * 100) : null;

    // Only include in summary if there is spending or a budget set
    if (spent > 0 || budgetAmount !== null) {
      results.push({
        category: cat,
        spent,
        budgetAmount,
        percentageUsed
      });
    }
  }

  // Sort by percentage used descending (most urgent first), then alphabetical
  return results.sort((a, b) => {
    const pA = a.percentageUsed ?? -1;
    const pB = b.percentageUsed ?? -1;
    if (pB !== pA) return pB - pA;
    return a.category.localeCompare(b.category);
  });
}
