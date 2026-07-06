import type { Batch } from '../types';

export const PREDICTED_LOW_STOCK_DAYS = 3;
export const CONSUMPTION_STALE_AFTER_DAYS = 90;
const MAX_COMPLETED_CYCLES = 5;
const SECONDS_PER_DAY = 86400;

export interface ConsumptionPrediction {
  itemId: string;
  unitsPerDay: number;
  currentQuantity: number;
  daysRemaining: number;
  projectedZeroAt: number;
  completedCycles: number;
}

export interface BatchForConsumption extends Batch {
  /** Original/restocked quantity for the batch. Added in migration 003. */
  initial_quantity?: number | null;
  /** Unix timestamp when the batch reached zero. Null while still active. */
  consumed_at?: number | null;
}

function finitePositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * Estimates when an item will run out based on completed restock cycles.
 *
 * Algorithm, intentionally simple and reviewable:
 * 1. Use only batches for this item that have both `initial_quantity > 0`
 *    and `consumed_at > date_added`; those are complete "restocked to empty"
 *    cycles retained by the soft-delete batch flow.
 * 2. Require at least two completed cycles, and ignore items whose latest
 *    completion is older than `staleAfterDays` (defaults to 90 days), because
 *    stale pantry history is not useful for proactive alerts.
 * 3. Convert up to the last five completed cycles to per-cycle rates
 *    (`initial_quantity / days_until_empty`). If at least three cycles are
 *    available, drop the slowest and fastest rate before averaging so one
 *    mis-click/outlier does not dominate the forecast.
 * 4. Project current positive quantity at the smoothed units/day rate.
 *
 * Returns null whenever a safe, finite forecast is not possible. Callers should
 * show nothing in that case rather than an error or a misleading number.
 */
export function predictConsumptionForItem(
  itemId: string,
  batches: BatchForConsumption[],
  nowSeconds = Math.floor(Date.now() / 1000),
  opts: { staleAfterDays?: number } = {}
): ConsumptionPrediction | null {
  const currentQuantity = batches
    .filter(b => b.item_id === itemId && b.quantity > 0)
    .reduce((sum, b) => sum + b.quantity, 0);
  if (currentQuantity <= 0) return null;

  const completed = batches
    .filter(b => b.item_id === itemId)
    .map(b => ({
      initial: Number(b.initial_quantity ?? 0),
      added: Number(b.date_added),
      consumed: Number(b.consumed_at ?? 0),
    }))
    .filter(c => finitePositive(c.initial) && finitePositive(c.added) && finitePositive(c.consumed) && c.consumed > c.added)
    .sort((a, b) => b.consumed - a.consumed);

  if (completed.length < 2) return null;

  const staleAfterDays = opts.staleAfterDays ?? CONSUMPTION_STALE_AFTER_DAYS;
  const latestConsumed = completed[0].consumed;
  if ((nowSeconds - latestConsumed) / SECONDS_PER_DAY > staleAfterDays) return null;

  const rates = completed
    .slice(0, MAX_COMPLETED_CYCLES)
    .map(c => {
      const days = (c.consumed - c.added) / SECONDS_PER_DAY;
      return days > 0 ? c.initial / days : NaN;
    })
    .filter(finitePositive);

  if (rates.length < 2) return null;

  const smoothed = rates.length >= 3
    ? [...rates].sort((a, b) => a - b).slice(1, -1)
    : rates;
  const unitsPerDay = smoothed.reduce((sum, r) => sum + r, 0) / smoothed.length;
  if (!finitePositive(unitsPerDay)) return null;

  const daysRemaining = currentQuantity / unitsPerDay;
  const projectedZeroAt = nowSeconds + Math.round(daysRemaining * SECONDS_PER_DAY);
  if (!Number.isFinite(daysRemaining) || daysRemaining < 0 || !Number.isFinite(projectedZeroAt)) return null;

  return {
    itemId,
    unitsPerDay,
    currentQuantity,
    daysRemaining,
    projectedZeroAt,
    completedCycles: completed.length,
  };
}
