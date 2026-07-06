-- Migration: per-batch locations + task-completion log.
--
-- schema.sql uses `CREATE TABLE IF NOT EXISTS`, so re-running it against an
-- already-deployed database will create `task_completions` fine (it's a
-- brand new table) but will NOT retroactively add the new `location_id`
-- column to an already-existing `batches` table. This migration applies
-- that column addition via ALTER TABLE, and (redundantly but harmlessly)
-- re-creates `task_completions`/its indexes for databases that run this
-- file before ever re-running the full schema.sql.
--
-- Safe to run once against an existing deployment:
--   wrangler d1 execute peerson-db --file=./migrations/002_batch_locations_and_task_completions.sql
--
-- Fresh setups should just run schema.sql (already includes all of this)
-- and do NOT need to run this file too.

-- SQLite/D1 has no "ADD COLUMN IF NOT EXISTS" -- this will error on a
-- second run if already applied. That's intentional (fail loud rather
-- than silently no-op'ing); a database only needs to run this file once.
ALTER TABLE batches ADD COLUMN location_id TEXT REFERENCES locations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_batches_location ON batches(location_id);

CREATE TABLE IF NOT EXISTS task_completions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  completed_by TEXT NOT NULL REFERENCES users(id),
  completed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_task_completions_household ON task_completions(household_id);
CREATE INDEX IF NOT EXISTS idx_task_completions_user ON task_completions(completed_by);
