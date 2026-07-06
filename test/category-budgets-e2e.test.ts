if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}
if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = {
    createElement: () => ({}),
    getElementById: () => null,
    querySelectorAll: () => [],
  };
}

import { describe, it, expect } from 'vitest';
import { computeCategoryBudgets } from '../src/utils/budgets';
import { renderExpensesView } from '../src/views/expenses';
import type { AppState, Expense, CategoryBudget, HouseholdMember } from '../src/types';

describe('Category Budgets E2E / UI Verification', () => {
  const members: HouseholdMember[] = [
    { id: 'u1', name: 'Alice', role: 'admin', joined_at: 0 },
    { id: 'u2', name: 'Bob', role: 'member', joined_at: 0 },
  ];

  function createMockApp(expenses: Expense[], budgets: CategoryBudget[]) {
    const state: Partial<AppState> = {
      userId: 'u1',
      userName: 'Alice',
      householdId: 'h1',
      household: { id: 'h1', name: 'WG Mitte', invite_code: 'ABC12345', created_at: 0 },
      members,
      expenses,
      splits: [],
      budgets,
      view: 'expenses',
    };
    return {
      state: state as AppState,
      getMemberName: (id: string) => members.find(m => m.id === id)?.name || id,
    } as any;
  }

  const nowTs = Math.floor(Date.now() / 1000);

  it('renders progress bar with --success color under 80%', () => {
    const expenses: Expense[] = [
      { id: 'e1', household_id: 'h1', title: 'Wocheneinkauf 1', amount: 150, paid_by: 'u1', split_type: 'equal', category: 'groceries', created_at: nowTs },
    ];
    const budgets: CategoryBudget[] = [
      { id: 'b1', household_id: 'h1', category: 'groceries', monthly_amount: 300, created_at: 0 },
    ];

    const app = createMockApp(expenses, budgets);
    const html = renderExpensesView(app);

    expect(html).toContain('Monatsbudgets');
    expect(html).toContain('150.00 € / 300.00 € (50%)');
    expect(html).toContain('color: var(--success);');
    expect(html).toContain('background: var(--success-bg);');
  });

  it('escalates progress bar to --warning color between 80% and 100%', () => {
    const expenses: Expense[] = [
      { id: 'e1', household_id: 'h1', title: 'Wocheneinkauf 1', amount: 150, paid_by: 'u1', split_type: 'equal', category: 'groceries', created_at: nowTs },
      { id: 'e2', household_id: 'h1', title: 'Wocheneinkauf 2', amount: 100, paid_by: 'u2', split_type: 'equal', category: 'groceries', created_at: nowTs },
    ];
    const budgets: CategoryBudget[] = [
      { id: 'b1', household_id: 'h1', category: 'groceries', monthly_amount: 300, created_at: 0 },
    ];

    const app = createMockApp(expenses, budgets);
    const html = renderExpensesView(app);

    expect(html).toContain('250.00 € / 300.00 € (83%)');
    expect(html).toContain('color: var(--warning);');
    expect(html).toContain('background: var(--warning-bg);');
  });

  it('escalates progress bar to --danger color over 100%', () => {
    const expenses: Expense[] = [
      { id: 'e1', household_id: 'h1', title: 'Wocheneinkauf 1', amount: 150, paid_by: 'u1', split_type: 'equal', category: 'groceries', created_at: nowTs },
      { id: 'e2', household_id: 'h1', title: 'Wocheneinkauf 2', amount: 100, paid_by: 'u2', split_type: 'equal', category: 'groceries', created_at: nowTs },
      { id: 'e3', household_id: 'h1', title: 'Wocheneinkauf 3', amount: 80, paid_by: 'u1', split_type: 'equal', category: 'groceries', created_at: nowTs },
    ];
    const budgets: CategoryBudget[] = [
      { id: 'b1', household_id: 'h1', category: 'groceries', monthly_amount: 300, created_at: 0 },
    ];

    const app = createMockApp(expenses, budgets);
    const html = renderExpensesView(app);

    expect(html).toContain('330.00 € / 300.00 € (110%)');
    expect(html).toContain('color: var(--danger);');
    expect(html).toContain('background: var(--danger-bg);');
  });
});
