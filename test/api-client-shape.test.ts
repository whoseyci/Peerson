import { describe, it, expect } from 'vitest';
import { api } from '../src/api/client';

// Regression guard for UI/client drift: views call these methods directly.
// This caught the real expense edit bug where saveEditedExpense() called
// api.expenses.update(...), but the client object did not expose it.
describe('API client surface', () => {
  it('exposes update() methods for resources edited by the UI', () => {
    expect(typeof api.expenses.update).toBe('function');
    expect(typeof api.tasks.update).toBe('function');
    expect(typeof api.shopping.update).toBe('function');
    expect(typeof api.items.update).toBe('function');
    expect(typeof api.locations.update).toBe('function');
  });

  it('exposes markSettled() for the settlement flow', () => {
    expect(typeof api.expenses.markSettled).toBe('function');
  });

  it('exposes GDPR export and account deletion helpers used by household settings', () => {
    expect(typeof api.households.exportData).toBe('function');
    expect(typeof api.users.deleteAccount).toBe('function');
  });
});
