import { describe, it, expect } from 'vitest';
import { api } from '../src/api/client';

// Regression test for a real bug: src/views/expenses.ts's saveEditedExpense()
// called api.expenses.update(...), but the client object never defined an
// `update` method on `expenses` -- only `list`, `create`, `delete`. Calling
// an undefined method threw a TypeError, silently caught by the surrounding
// try/catch and surfaced to the user as a generic "Fehler beim
// Aktualisieren" toast, even though the backend endpoint
// (functions/api/expenses/[id].ts onRequestPatch) was correct and working.
//
// This is a lightweight "does the API surface have the methods the UI
// actually calls" check -- deliberately not exercising a real fetch (the
// client module reads `localStorage` at call time, which isn't meaningfully
// mockable in the node test environment without extra setup), just proving
// the method exists and is callable, which is exactly what was missing.
describe('API client surface', () => {
  it('exposes an update() method on every resource the UI calls .update(...) on', () => {
    expect(typeof api.expenses.update).toBe('function');
    expect(typeof api.tasks.update).toBe('function');
    expect(typeof api.shopping.update).toBe('function');
    expect(typeof api.items.update).toBe('function');
    expect(typeof api.locations.update).toBe('function');
  });
});
