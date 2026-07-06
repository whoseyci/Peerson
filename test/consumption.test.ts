import { describe, expect, it } from 'vitest';
import type { Batch } from '../src/types';
import { predictConsumptionForItem } from '../src/utils/consumption';

const DAY = 86400;
const now = 1_700_000_000;

function batch(id: string, itemId: string, initial: number, daysAgoAdded: number, daysAgoConsumed: number | null, quantity = 0): Batch {
  return {
    id,
    item_id: itemId,
    quantity,
    grams_per_unit: 0,
    date_added: now - daysAgoAdded * DAY,
    initial_quantity: initial,
    consumed_at: daysAgoConsumed === null ? null : now - daysAgoConsumed * DAY,
  };
}

describe('predictConsumptionForItem', () => {
  it('predicts a clean regular consumption pattern', () => {
    const batches = [
      batch('c1', 'milk', 6, 30, 24), // 1 unit/day
      batch('c2', 'milk', 6, 22, 16), // 1 unit/day
      batch('c3', 'milk', 6, 14, 8),  // 1 unit/day
      batch('active', 'milk', 2, 1, null, 2),
    ];

    const prediction = predictConsumptionForItem('milk', batches, now);
    expect(prediction).not.toBeNull();
    expect(prediction!.unitsPerDay).toBeCloseTo(1, 4);
    expect(prediction!.daysRemaining).toBeCloseTo(2, 4);
    expect(prediction!.projectedZeroAt).toBe(now + 2 * DAY);
  });

  it('returns null for insufficient history', () => {
    expect(predictConsumptionForItem('milk', [], now)).toBeNull();
    expect(predictConsumptionForItem('milk', [batch('c1', 'milk', 4, 10, 6), batch('active', 'milk', 2, 1, null, 2)], now)).toBeNull();
  });

  it('returns null for all-same-day completed batches', () => {
    const batches = [
      { ...batch('c1', 'milk', 4, 5, 5), consumed_at: now - 5 * DAY },
      { ...batch('c2', 'milk', 4, 4, 4), consumed_at: now - 4 * DAY },
      batch('active', 'milk', 2, 1, null, 2),
    ];
    expect(predictConsumptionForItem('milk', batches, now)).toBeNull();
  });

  it('returns null for stale consumption history', () => {
    const batches = [
      batch('c1', 'spice', 2, 140, 130),
      batch('c2', 'spice', 2, 120, 110),
      batch('active', 'spice', 1, 1, null, 1),
    ];
    expect(predictConsumptionForItem('spice', batches, now)).toBeNull();
  });

  it('smooths a noisy outlier rather than letting it dominate', () => {
    const batches = [
      batch('c1', 'coffee', 6, 50, 44), // 1/day
      batch('c2', 'coffee', 6, 40, 34), // 1/day
      batch('c3', 'coffee', 6, 30, 24), // 1/day
      batch('outlier', 'coffee', 20, 20, 19), // 20/day outlier, trimmed
      batch('active', 'coffee', 4, 1, null, 4),
    ];

    const prediction = predictConsumptionForItem('coffee', batches, now);
    expect(prediction).not.toBeNull();
    expect(prediction!.daysRemaining).toBeGreaterThan(3);
    expect(prediction!.daysRemaining).toBeLessThan(5);
  });
});
