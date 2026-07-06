import { describe, it, expect } from 'vitest';
import { sortBatchesFifo } from '../src/utils/roomStock';

describe('sortBatchesFifo', () => {
  it('sorts dated batches soonest-expiry first', () => {
    const batches = [
      { id: 'b1', expiry: '2030-06-01' },
      { id: 'b2', expiry: '2030-01-01' },
      { id: 'b3', expiry: '2030-03-01' },
    ];
    expect(sortBatchesFifo(batches).map(b => b.id)).toEqual(['b2', 'b3', 'b1']);
  });

  it('matches the pre-existing inventory.ts behavior of sorting undated batches BEFORE dated ones', () => {
    // This looks backwards for "use soonest-to-expire first" intuition,
    // but it's the exact, already-shipped behavior of
    // `(a.expiry || '').localeCompare(b.expiry || '')` in inventory.ts's
    // removeOne()/openItemDetail() -- an empty string sorts before any
    // non-empty date string. This test exists specifically to catch any
    // future "fix" that accidentally changes real removal order.
    const batches = [
      { id: 'dated', expiry: '2030-01-01' },
      { id: 'undated', expiry: undefined },
    ];
    expect(sortBatchesFifo(batches).map(b => b.id)).toEqual(['undated', 'dated']);
  });

  it('does not mutate the input array', () => {
    const batches = [{ id: 'b1', expiry: '2030-06-01' }, { id: 'b2', expiry: '2030-01-01' }];
    const original = [...batches];
    sortBatchesFifo(batches);
    expect(batches).toEqual(original);
  });
});
