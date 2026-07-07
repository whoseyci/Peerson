import { describe, it, expect } from 'vitest';
import type { CategoryBudget, Expense } from '../src/types';
import { budgetProgressLines, cleanExpenseTitle, isSettlementExpense, monthlySpentByCategory, startOfThisMonth } from '../src/utils/budgets';

function ts(y: number, m: number, d: number): number {
  return Math.floor(new Date(y, m, d, 12, 0, 0).getTime() / 1000);
}

const now = new Date(2026, 6, 15, 10, 0, 0);

describe('budget utilities', () => {
  it('returns the first day of the current month at local midnight', () => {
    const result = startOfThisMonth(new Date(2026, 6, 15, 22, 30));
    const expected = new Date(2026, 6, 1, 0, 0, 0, 0);
    expect(result).toBe(Math.floor(expected.getTime() / 1000));
  });

  it('sums only current-month real spending categories', () => {
    const expenses: Expense[] = [
      { id: 'e1', household_id: 'h1', title: 'Groceries', amount: 50, paid_by: 'u1', split_type: 'equal', category: 'groceries', created_at: ts(2026, 6, 2) },
      { id: 'e2', household_id: 'h1', title: 'More', amount: 25, paid_by: 'u1', split_type: 'equal', category: 'groceries', created_at: ts(2026, 6, 10) },
      { id: 'e3', household_id: 'h1', title: 'Old', amount: 999, paid_by: 'u1', split_type: 'equal', category: 'groceries', created_at: ts(2026, 5, 10) },
      { id: 'e4', household_id: 'h1', title: 'Schuldenausgleich', amount: 40, paid_by: 'u1', split_type: 'custom', category: 'settlement', created_at: ts(2026, 6, 3) },
    ];
    expect(monthlySpentByCategory(expenses, now)).toEqual({ groceries: 75 });
  });

  it('computes progress status thresholds', () => {
    const budgets: CategoryBudget[] = [
      { id: 'b1', household_id: 'h1', category: 'groceries', monthly_amount: 100, created_at: 0 },
      { id: 'b2', household_id: 'h1', category: 'rent', monthly_amount: 100, created_at: 0 },
      { id: 'b3', household_id: 'h1', category: 'household', monthly_amount: 100, created_at: 0 },
      { id: 'b4', household_id: 'h1', category: 'settlement', monthly_amount: 100, created_at: 0 },
    ];
    const expenses: Expense[] = [
      { id: 'e1', household_id: 'h1', title: 'A', amount: 50, paid_by: 'u1', split_type: 'equal', category: 'groceries', created_at: ts(2026, 6, 1) },
      { id: 'e2', household_id: 'h1', title: 'B', amount: 85, paid_by: 'u1', split_type: 'equal', category: 'rent', created_at: ts(2026, 6, 1) },
      { id: 'e3', household_id: 'h1', title: 'C', amount: 120, paid_by: 'u1', split_type: 'equal', category: 'household', created_at: ts(2026, 6, 1) },
    ];
    const lines = budgetProgressLines(budgets, expenses, now);
    expect(lines.map(l => [l.category, l.status])).toEqual([
      ['household', 'danger'],
      ['rent', 'warning'],
      ['groceries', 'success'],
    ]);
  });

  it('excludes a settlement-titled expense from monthly spend even if its category is not "settlement"', () => {
    // Regression: a settlement transfer should never count against a
    // category budget no matter how it got mis-categorized -- the normal
    // path (executeSettlement() in src/views/expenses.ts) always sets
    // category: 'settlement', which isBudgetableCategory() already
    // excludes, but a hand-edited expense could plausibly end up with a
    // settlement-sounding title under a real budgetable category instead.
    const expenses: Expense[] = [
      { id: 'e1', household_id: 'h1', title: '💸 Schuldenausgleich: Alice → Bob', amount: 40, paid_by: 'u1', split_type: 'custom', category: 'sonstiges', created_at: ts(2026, 6, 3) },
      { id: 'e2', household_id: 'h1', title: 'Ausgleich für Miete', amount: 60, paid_by: 'u1', split_type: 'equal', category: 'household', created_at: ts(2026, 6, 4) },
      { id: 'e3', household_id: 'h1', title: 'Real groceries', amount: 30, paid_by: 'u1', split_type: 'equal', category: 'groceries', created_at: ts(2026, 6, 5) },
    ];
    expect(monthlySpentByCategory(expenses, now)).toEqual({ groceries: 30 });
  });

  describe('isSettlementExpense / cleanExpenseTitle', () => {
    it('detects settlement by category regardless of title', () => {
      expect(isSettlementExpense({ title: 'Whatever', category: 'settlement' })).toBe(true);
    });

    it('detects settlement by title even with a non-settlement category', () => {
      expect(isSettlementExpense({ title: 'Schuldenausgleich: A → B', category: 'sonstiges' })).toBe(true);
      expect(isSettlementExpense({ title: 'Quick ausgleich', category: 'groceries' })).toBe(true);
      expect(isSettlementExpense({ title: 'Settlement payment', category: null })).toBe(true);
    });

    it('does not flag ordinary expenses as settlements', () => {
      expect(isSettlementExpense({ title: 'Wocheneinkauf', category: 'groceries' })).toBe(false);
    });

    it('strips the leading emoji prefix before matching', () => {
      expect(cleanExpenseTitle('💸 Schuldenausgleich: Alice → Bob')).toBe('Schuldenausgleich: Alice → Bob');
      expect(isSettlementExpense({ title: '💸 Schuldenausgleich: Alice → Bob', category: null })).toBe(true);
    });
  });
});
