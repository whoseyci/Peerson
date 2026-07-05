-- Migration: nested storage locations + item price/history.
--
-- schema.sql uses `CREATE TABLE IF NOT EXISTS`, so re-running it against an
-- already-deployed database is a no-op for tables that already exist (like
-- `items`) -- it will NOT retroactively add new columns. This migration
-- applies the same additions via ALTER TABLE for databases that already had
-- the pre-locations/pre-pricing `items` table created.
--
-- Safe to run once against an existing deployment:
--   wrangler d1 execute peerson-db --file=./migrations/001_locations_and_pricing.sql
--
-- Fresh setups should just run schema.sql (already includes all of this)
-- and do NOT need to run this file too.

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_locations_household ON locations(household_id);
CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations(parent_id);

CREATE TABLE IF NOT EXISTS item_price_history (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  price_cents INTEGER NOT NULL,
  effective_from INTEGER NOT NULL DEFAULT (unixepoch()),
  effective_until INTEGER
);
CREATE INDEX IF NOT EXISTS idx_item_price_history_item ON item_price_history(item_id);

-- SQLite/D1 has no "ADD COLUMN IF NOT EXISTS" -- these will error on a
-- second run if already applied. That's intentional (fail loud rather than
-- silently no-op'ing); a database only needs to run this file once.
ALTER TABLE items ADD COLUMN location_id TEXT REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN price_cents INTEGER;
