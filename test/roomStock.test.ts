import { describe, it, expect } from 'vitest';
import {
  effectiveBatchLocation,
  subtreeLocationIds,
  itemsAtLocation,
  itemCountInSubtree,
  lowStockAlertCountInSubtree,
} from '../src/utils/roomStock';
import type { Item, Batch, Location } from '../src/types';

function item(id: string, overrides: Partial<Item> = {}): Item {
  return { id, household_id: 'h1', name: id, category: 'sonstiges', threshold: 1, barcodes: [], nutrition: {}, ...overrides };
}
function batch(id: string, item_id: string, quantity: number, overrides: Partial<Batch> = {}): Batch {
  return { id, item_id, quantity, grams_per_unit: 0, date_added: 0, ...overrides };
}
function loc(id: string, parent_id: string | null = null): Location {
  return { id, household_id: 'h1', parent_id, name: id, sort_order: 0 };
}

describe('effectiveBatchLocation', () => {
  it('uses the batch own location_id when set', () => {
    const b = batch('b1', 'i1', 1, { location_id: 'garage' });
    expect(effectiveBatchLocation(b, item('i1', { location_id: 'kitchen' }))).toBe('garage');
  });

  it('falls back to the item location_id when the batch has none', () => {
    const b = batch('b1', 'i1', 1);
    expect(effectiveBatchLocation(b, item('i1', { location_id: 'kitchen' }))).toBe('kitchen');
  });

  it('returns null when neither the batch nor the item has a location', () => {
    const b = batch('b1', 'i1', 1);
    expect(effectiveBatchLocation(b, item('i1'))).toBeNull();
  });
});

describe('subtreeLocationIds', () => {
  it('includes the root and all nested descendants', () => {
    const locations = [loc('kitchen'), loc('fridge', 'kitchen'), loc('shelf', 'fridge'), loc('garage')];
    expect(subtreeLocationIds(locations, 'kitchen')).toEqual(new Set(['kitchen', 'fridge', 'shelf']));
  });

  it('is just the root itself for a leaf with no children', () => {
    const locations = [loc('kitchen'), loc('garage')];
    expect(subtreeLocationIds(locations, 'garage')).toEqual(new Set(['garage']));
  });
});

describe('itemsAtLocation', () => {
  it('sums quantity only from batches effectively located here', () => {
    const items = [item('milk', { location_id: 'kitchen' })];
    const batches = [
      batch('b1', 'milk', 2, { location_id: 'kitchen' }),
      batch('b2', 'milk', 3, { location_id: 'garage' }),
    ];
    const result = itemsAtLocation(items, batches, 'kitchen');
    expect(result).toEqual([{ item: items[0], quantity: 2 }]);
  });

  it('shows an item with quantity 0 if it is assigned here but has no batches at all', () => {
    const items = [item('flour', { location_id: 'pantry' })];
    const result = itemsAtLocation(items, [], 'pantry');
    expect(result).toEqual([{ item: items[0], quantity: 0 }]);
  });

  it('does not show a zero-quantity item if some OTHER batch of it exists elsewhere', () => {
    // Item nominally lives in "pantry" but its only batch was moved to
    // "garage" -- pantry should show nothing for it now.
    const items = [item('flour', { location_id: 'pantry' })];
    const batches = [batch('b1', 'flour', 5, { location_id: 'garage' })];
    expect(itemsAtLocation(items, batches, 'pantry')).toEqual([]);
  });

  it('aggregates multiple batches of the same item at the same location', () => {
    const items = [item('milk', { location_id: 'kitchen' })];
    const batches = [
      batch('b1', 'milk', 2, { location_id: 'kitchen' }),
      batch('b2', 'milk', 1, { location_id: 'kitchen' }),
    ];
    expect(itemsAtLocation(items, batches, 'kitchen')).toEqual([{ item: items[0], quantity: 3 }]);
  });
});

describe('itemCountInSubtree', () => {
  it('counts an item once even if split across a room and its own container', () => {
    const items = [item('milk', { location_id: 'kitchen' })];
    const batches = [
      batch('b1', 'milk', 1, { location_id: 'kitchen' }),
      batch('b2', 'milk', 1, { location_id: 'fridge' }),
    ];
    const locations = [loc('kitchen'), loc('fridge', 'kitchen')];
    expect(itemCountInSubtree(items, batches, locations, 'kitchen')).toBe(1);
  });

  it('does not count items with zero quantity', () => {
    const items = [item('milk', { location_id: 'kitchen' })];
    const batches = [batch('b1', 'milk', 0, { location_id: 'kitchen' })];
    const locations = [loc('kitchen')];
    expect(itemCountInSubtree(items, batches, locations, 'kitchen')).toBe(0);
  });

  it('does not count items located outside the subtree', () => {
    const items = [item('milk', { location_id: 'garage' })];
    const batches = [batch('b1', 'milk', 3, { location_id: 'garage' })];
    const locations = [loc('kitchen'), loc('garage')];
    expect(itemCountInSubtree(items, batches, locations, 'kitchen')).toBe(0);
  });
});

describe('lowStockAlertCountInSubtree', () => {
  it('flags an item present in the subtree whose GLOBAL total is below threshold', () => {
    const items = [item('milk', { threshold: 5 })];
    const batches = [
      batch('b1', 'milk', 1, { location_id: 'kitchen' }),
      batch('b2', 'milk', 1, { location_id: 'garage' }), // outside subtree, still counts toward global total
    ];
    const locations = [loc('kitchen'), loc('garage')];
    // Global total is 2 (< threshold 5), and milk IS present in "kitchen"'s subtree.
    expect(lowStockAlertCountInSubtree(items, batches, locations, 'kitchen')).toBe(1);
  });

  it('does not flag an item that is above threshold globally even if a single batch here is small', () => {
    const items = [item('milk', { threshold: 2 })];
    const batches = [
      batch('b1', 'milk', 1, { location_id: 'kitchen' }),
      batch('b2', 'milk', 5, { location_id: 'garage' }),
    ];
    const locations = [loc('kitchen'), loc('garage')];
    expect(lowStockAlertCountInSubtree(items, batches, locations, 'kitchen')).toBe(0);
  });

  it('does not flag a globally-low item that has no presence in this subtree at all', () => {
    const items = [item('milk', { threshold: 5 })];
    const batches = [batch('b1', 'milk', 1, { location_id: 'garage' })];
    const locations = [loc('kitchen'), loc('garage')];
    expect(lowStockAlertCountInSubtree(items, batches, locations, 'kitchen')).toBe(0);
  });
});
