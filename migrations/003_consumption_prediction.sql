-- Migration: retain consumed batch history for consumption prediction.
--
-- Peerson used to hard-delete a batch when its quantity reached zero. That
-- erased the exact restocked-to-empty cycle needed to estimate consumption
-- rate. This migration adds two nullable columns so new/updated batches can
-- be retained at quantity=0 with enough history to forecast future run-out.
--
-- Safe to run once against an existing deployment:
--   wrangler d1 execute peerson-db --file=./migrations/003_consumption_prediction.sql
--
-- Fresh setups should just run schema.sql (already includes all of this)
-- and do NOT need to run this file too.

-- SQLite/D1 has no "ADD COLUMN IF NOT EXISTS" -- this will error on a
-- second run if already applied. That's intentional; run this once.
ALTER TABLE batches ADD COLUMN initial_quantity INTEGER DEFAULT NULL;
ALTER TABLE batches ADD COLUMN consumed_at INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_batches_consumed_at ON batches(item_id, consumed_at);

-- Existing active batches did not previously track their original restock
-- quantity. For active rows, the current quantity is the best conservative
-- baseline; newly-created rows will store the actual initial quantity at
-- insert time going forward.
UPDATE batches
SET initial_quantity = quantity
WHERE initial_quantity IS NULL AND quantity > 0;
