-- Migration: Web Push subscriptions and notification deduplication log.
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
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_household ON push_subscriptions(household_id);

CREATE TABLE IF NOT EXISTS notification_log (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  sent_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_notification_log_dedupe ON notification_log(household_id, dedupe_key);
