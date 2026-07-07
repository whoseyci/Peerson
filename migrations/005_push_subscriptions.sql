-- Migration: Web Push subscriptions + notification dedup log (Issue #48).
--
-- Adds two tables:
--
-- 1. `push_subscriptions` — one row per (user, browser/device) that has
--    opted in to notifications. A single user can have several rows
--    across their phone/laptop/etc.; when a notification fires we push
--    to *all* of their active endpoints and delete any that the push
--    service tells us are expired (HTTP 404/410).
--
-- 2. `notification_log` — a per-household append-only log of which
--    dedup keys we've already sent a push for. Keeps a scheduled job
--    (or an immediate-event handler running multiple times) from
--    re-notifying about the same task/batch/expense repeatedly. The
--    `dedupe_key` column is UNIQUE per household so INSERT-OR-IGNORE
--    doubles as a cheap "did we already send this?" check.
--
-- Safe to run once against an existing deployment:
--   wrangler d1 execute peerson-db --file=./migrations/005_push_subscriptions.sql
--
-- Fresh setups should just run schema.sql (already includes all of this)
-- and do NOT need to run this file too.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- The same physical device/browser produces the same push endpoint URL
-- even across re-subscribes, so we treat (user_id, endpoint) as the
-- natural identity: an upsert on subscribe just refreshes the keys.
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_user_endpoint
  ON push_subscriptions(user_id, endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_household ON push_subscriptions(household_id);

CREATE TABLE IF NOT EXISTS notification_log (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  sent_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- Enforces "at most one send per household per dedupe_key" so a repeated
-- INSERT (e.g. cron firing twice in the same day for the same "task X
-- due today" event) becomes a no-op via INSERT OR IGNORE without any
-- extra SELECT.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_log_household_key
  ON notification_log(household_id, dedupe_key);
