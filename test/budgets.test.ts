import { describe, it, expect } from 'vitest';
import { startOfThisMonth, computeCategoryBudgets } from '../src/utils/budgets';
import type { Expense, CategoryBudget } from '../src/types';

function mockExpense(id: string, category: string, amount: number, created_at: number, title = 'Test expense'): Expense {
  return { id, household_id: 'h1', title, amount, paid_by: 'u1', split_type: 'equal', category, created_at };
}

function mockBudget(id: string, category: string, monthly_amount: number): CategoryBudget {
  return { id, household_id: 'h1', category, monthly_amount, created_at: 0 };
}

describe('startOfThisMonth', () => {
  it('returns the 1st of the current month at midnight local time for a mid-month date', () => {
    // 15th of July 2026, 14:30:00 -> 1st of July 2026, 00:00:00
    const midJuly = new Date(2026, 6, 15, 14, 30, 0);
    const result = startOfThisMonth(midJuly);
    const expected = new Date(2026, 6, 1, 0, 0, 0, 0);
    expect(result).toBe(Math.floor(expected.getTime() / 1000));
  });

  it('returns the same timestamp when given the 1st of the month at 00:00:00', () => {
    const firstJuly = new Date(2026, 6, 1, 0, 0, 0, 0);
    const result = startOfThisMonth(firstJuly);
    expect(result).toBe(Math.floor(firstJuly.getTime() / 1000));
  });
});

describe('computeCategoryBudgets', () => {
  const refDate = new Date(2026, 6, 15, 12, 0, 0); // 15th July 2026
  const julyStartTs = Math.floor(new Date(2026, 6, 1, 0, 0, 0, 0).getTime() / 1000);
  const juneEndTs = julyStartTs - 1; // last second of June 2026
  const julyMidTs = julyStartTs + 86400 * 5; // 6th July 2026

  it('correctly filters expenses to the current calendar month only', () => {
    const expenses = [
      mockExpense('e1', 'groceries', 50, juneEndTs), // June (last second of previous month) -> ignored
      mockExpense('e2', 'groceries', 100, julyStartTs), // July 1st 00:00:00 -> counted
      mockExpense('e3', 'groceries', 20, julyMidTs), // July 6th -> counted
    ];
    const budgets = [mockBudget('b1', 'groceries', 200)];

    const res = computeCategoryBudgets(expenses, budgets, refDate);
    const groceries = res.find(r => r.category === 'groceries');
    expect(groceries).toBeDefined();
    expect(groceries?.spent).toBe(120); // only 100 + 20
    expect(groceries?.percentageUsed).toBe(60); // 120 / 200 = 60%
  });

  it('handles month boundary edge cases precisely (last second of month vs first second of next)', () => {
    const expenses = [
      mockExpense('prevEnd', 'rent', 800, juneEndTs),
      mockExpense('currStart', 'rent', 800, julyStartTs),
    ];
    const res = computeCategoryBudgets(expenses, [], refDate);
    const rent = res.find(r => r.category === 'rent');
    expect(rent?.spent).toBe(800);
  });

  it('excludes settlement expenses from budgeting calculations entirely', () => {
    const expenses = [
      mockExpense('e1', 'settlement', 150, julyMidTs, 'Schuldenausgleich'),
      mockExpense('e2', 'sonstiges', 50, julyMidTs, 'Ausgleich an Bob'),
      mockExpense('e3', 'groceries', 80, julyMidTs, 'Supermarkt'),
    ];
    const res = computeCategoryBudgets(expenses, [mockBudget('b1', 'settlement', 500)], refDate);
    expect(res.some(r => r.category === 'settlement')).toBe(false);
    const groceries = res.find(r => r.category === 'groceries');
    expect(groceries?.spent).toBe(80);
  });

  it('handles categories with no budget set without errors', () => {
    const expenses = [mockExpense('e1', 'leisure', 45, julyMidTs)];
    const res = computeCategoryBudgets(expenses, [], refDate);
    const leisure = res.find(r => r.category === 'leisure');
    expect(leisure).toBeDefined();
    expect(leisure?.spent).toBe(45);
    expect(leisure?.budgetAmount).toBeNull();
    expect(leisure?.percentageUsed).toBeNull();
  });
});
