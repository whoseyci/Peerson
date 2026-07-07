import { describe, it, expect, beforeEach } from 'vitest';
import type { Item, Batch, Task, Expense, ExpenseSplit, HouseholdMember } from '../src/types';

// The test environment runs under Node (see vitest.config.ts), which has
// no `localStorage` global -- unlike every other utility module tested so
// far, feed.ts's snooze helpers are localStorage-backed (matching the
// existing pattern in shopping.ts's dismissed-suggestions key), so they
// need a minimal in-memory polyfill here before importing the module
// under test.
if (typeof (globalThis as any).localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
}

import { computeFeed, getSnoozedKeys, snoozeKey } from '../src/utils/feed';

function iso(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

const members: HouseholdMember[] = [
  { id: 'u1', name: 'Alice', role: 'admin', joined_at: 0 },
  { id: 'u2', name: 'Bob', role: 'member', joined_at: 0 },
];

describe('computeFeed', () => {
  it('returns nothing for a fully quiet household', () => {
    const feed = computeFeed(
      { items: [], batches: [], tasks: [], expenses: [], splits: [], members, userId: 'u1' },
      new Set()
    );
    expect(feed).toEqual([]);
  });

  it('surfaces a batch expiring within 3 days but not one expiring in 10 days', () => {
    const items: Item[] = [
      { id: 'i1', household_id: 'h1', name: 'Milch', category: 'milch', threshold: 1, barcodes: [], nutrition: {} },
      { id: 'i2', household_id: 'h1', name: 'Reis', category: 'getreide', threshold: 1, barcodes: [], nutrition: {} },
    ];
    const batches: Batch[] = [
      { id: 'b1', item_id: 'i1', quantity: 1, expiry: iso(2), grams_per_unit: 0, date_added: 0 },
      { id: 'b2', item_id: 'i2', quantity: 1, expiry: iso(10), grams_per_unit: 0, date_added: 0 },
    ];
    const feed = computeFeed(
      { items, batches, tasks: [], expenses: [], splits: [], members, userId: 'u1' },
      new Set()
    );
    expect(feed.map(f => f.key)).toEqual(['expiring:b1']);
    expect(feed[0].kind).toBe('expiring');
  });

  it('surfaces low-stock items sorted with the most depleted first', () => {
    const items: Item[] = [
      { id: 'i1', household_id: 'h1', name: 'Kaffee', category: 'sonstiges', threshold: 5, barcodes: [], nutrition: {} },
      { id: 'i2', household_id: 'h1', name: 'Zucker', category: 'sonstiges', threshold: 5, barcodes: [], nutrition: {} },
    ];
    const batches: Batch[] = [
      { id: 'b1', item_id: 'i1', quantity: 4, grams_per_unit: 0, date_added: 0 }, // 1 below threshold
      { id: 'b2', item_id: 'i2', quantity: 0, grams_per_unit: 0, date_added: 0 }, // 5 below threshold
    ];
    const feed = computeFeed(
      { items, batches, tasks: [], expenses: [], splits: [], members, userId: 'u1' },
      new Set()
    );
    expect(feed.map(f => f.key)).toEqual(['lowstock:i2', 'lowstock:i1']);
  });



  it('surfaces predicted-low items before they cross the static threshold', () => {
    const now = Math.floor(Date.now() / 1000);
    const day = 86400;
    const items: Item[] = [
      { id: 'i1', household_id: 'h1', name: 'Milch', category: 'milch', threshold: 1, barcodes: [], nutrition: {} },
    ];
    const batches: Batch[] = [
      { id: 'old1', item_id: 'i1', quantity: 0, grams_per_unit: 0, date_added: now - 20 * day, initial_quantity: 6, consumed_at: now - 14 * day },
      { id: 'old2', item_id: 'i1', quantity: 0, grams_per_unit: 0, date_added: now - 12 * day, initial_quantity: 6, consumed_at: now - 6 * day },
      { id: 'active', item_id: 'i1', quantity: 2, grams_per_unit: 0, date_added: now - day, initial_quantity: 2 },
    ];

    const feed = computeFeed(
      { items, batches, tasks: [], expenses: [], splits: [], members, userId: 'u1' },
      new Set()
    );

    expect(feed.map(f => f.key)).toEqual(['predicted-low:i1']);
    expect(feed[0].kind).toBe('predicted-low');
  });

  it('suppresses predicted-low when static low-stock already applies', () => {
    const now = Math.floor(Date.now() / 1000);
    const day = 86400;
    const items: Item[] = [
      { id: 'i1', household_id: 'h1', name: 'Milch', category: 'milch', threshold: 3, barcodes: [], nutrition: {} },
    ];
    const batches: Batch[] = [
      { id: 'old1', item_id: 'i1', quantity: 0, grams_per_unit: 0, date_added: now - 20 * day, initial_quantity: 6, consumed_at: now - 14 * day },
      { id: 'old2', item_id: 'i1', quantity: 0, grams_per_unit: 0, date_added: now - 12 * day, initial_quantity: 6, consumed_at: now - 6 * day },
      { id: 'active', item_id: 'i1', quantity: 2, grams_per_unit: 0, date_added: now - day, initial_quantity: 2 },
    ];

    const feed = computeFeed(
      { items, batches, tasks: [], expenses: [], splits: [], members, userId: 'u1' },
      new Set()
    );

    expect(feed.map(f => f.key)).toEqual(['lowstock:i1']);
  });

  it('does not resurface low-stock items that are already on the open shopping list', () => {
    const items: Item[] = [
      { id: 'i1', household_id: 'h1', name: 'Kaffee', category: 'sonstiges', threshold: 5, barcodes: [], nutrition: {} },
    ];
    const batches: Batch[] = [{ id: 'b1', item_id: 'i1', quantity: 0, grams_per_unit: 0, date_added: 0 }];
    const feed = computeFeed(
      {
        items,
        batches,
        tasks: [],
        expenses: [],
        splits: [],
        members,
        userId: 'u1',
        shopping: [{ id: 'sh1', household_id: 'h1', name: 'Kaffee', status: 'open', linked_item_id: 'i1' }],
      },
      new Set()
    );
    expect(feed).toEqual([]);
  });

  it('surfaces tasks due within 2 days but not tasks already done', () => {
    const tasks: Task[] = [
      { id: 't1', household_id: 'h1', title: 'Müll rausbringen', status: 'todo', due_date: iso(1) },
      { id: 't2', household_id: 'h1', title: 'Bad putzen', status: 'todo', due_date: iso(9) },
      { id: 't3', household_id: 'h1', title: 'Erledigt', status: 'done', due_date: iso(0) },
    ];
    const feed = computeFeed(
      { items: [], batches: [], tasks, expenses: [], splits: [], members, userId: 'u1' },
      new Set()
    );
    expect(feed.map(f => f.key)).toEqual(['task:t1']);
  });

  it('surfaces personal balances via the same logic as personalBalanceLines', () => {
    const expenses: Expense[] = [
      { id: 'e1', household_id: 'h1', title: 'Einkauf', amount: 20, paid_by: 'u2', split_type: 'equal', created_at: 0 },
    ];
    const splits: ExpenseSplit[] = [
      { id: 's1', expense_id: 'e1', user_id: 'u1', amount: 10, settled: 0 },
      { id: 's2', expense_id: 'e1', user_id: 'u2', amount: 10, settled: 0 },
    ];
    const feed = computeFeed(
      { items: [], batches: [], tasks: [], expenses, splits, members, userId: 'u1' },
      new Set()
    );
    expect(feed).toHaveLength(1);
    expect(feed[0].kind).toBe('balance');
    expect(feed[0].title).toContain('Bob');
  });

  it('excludes anything whose key is in the snoozed set', () => {
    const items: Item[] = [
      { id: 'i1', household_id: 'h1', name: 'Kaffee', category: 'sonstiges', threshold: 5, barcodes: [], nutrition: {} },
    ];
    const batches: Batch[] = [{ id: 'b1', item_id: 'i1', quantity: 0, grams_per_unit: 0, date_added: 0 }];
    const feed = computeFeed(
      { items, batches, tasks: [], expenses: [], splits: [], members, userId: 'u1' },
      new Set(['lowstock:i1'])
    );
    expect(feed).toEqual([]);
  });

  it('sorts the most urgent (most overdue / most depleted) entries first', () => {
    const items: Item[] = [
      { id: 'i1', household_id: 'h1', name: 'A', category: 'sonstiges', threshold: 2, barcodes: [], nutrition: {} },
    ];
    const batches: Batch[] = [{ id: 'b1', item_id: 'i1', quantity: 1, expiry: iso(-2), grams_per_unit: 0, date_added: 0 }];
    const tasks: Task[] = [{ id: 't1', household_id: 'h1', title: 'Task', status: 'todo', due_date: iso(-1) }];
    const feed = computeFeed(
      { items, batches, tasks, expenses: [], splits: [], members, userId: 'u1' },
      new Set()
    );
    // The already-expired batch (urgency -2) should sort before the
    // overdue task (urgency 5 + -1 = 4) and before the also-derived
    // low-stock entry for the same item (urgency 10+).
    expect(feed[0].key).toBe('expiring:b1');
  });
});

describe('snooze persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns an empty set for a household with nothing snoozed', () => {
    expect(getSnoozedKeys('h1')).toEqual(new Set());
  });

  it('returns an empty set when no household is active', () => {
    expect(getSnoozedKeys(null)).toEqual(new Set());
  });

  it('remembers a snoozed key for the same day', () => {
    snoozeKey('h1', 'lowstock:i1');
    expect(getSnoozedKeys('h1')).toEqual(new Set(['lowstock:i1']));
  });

  it('keeps snoozed keys scoped to their own household', () => {
    snoozeKey('h1', 'lowstock:i1');
    expect(getSnoozedKeys('h2')).toEqual(new Set());
  });

  it('expires a snooze recorded on a previous day', () => {
    const storageKey = 'peerson_home_snoozed_h1';
    localStorage.setItem(storageKey, JSON.stringify({ 'lowstock:i1': '2000-01-01' }));
    expect(getSnoozedKeys('h1')).toEqual(new Set());
  });
});
