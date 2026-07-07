// Higher-level helper for firing Web Push notifications from other API
// handlers (e.g. `expenses.ts` calls this after inserting a new expense).
//
// Kept separate from `_pushLib.ts` because that module is pure crypto with
// no D1/DB dependency — this one wraps the DB fetch + dedup + expired-
// subscription cleanup around it.
//
// File is named `_pushNotify.ts` (no `lib/` substring) so `test/build.test.ts`
// stays green when other files under `functions/api/` import from it.

import { readVapidConfig, sendPush, type PushEnv, type PushSubscriptionKeys } from './_pushLib';
import type { Env as BaseEnv } from '../_middleware';

export interface Env extends BaseEnv, PushEnv {}

export interface NotificationPayload {
  /** Short title shown in the OS notification banner. */
  title: string;
  /** Body text shown below the title. */
  body: string;
  /** Optional URL to navigate to when the notification is tapped. */
  url?: string;
  /** Optional tag so newer notifications of the same "kind" replace older ones on-device. */
  tag?: string;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Send `payload` to every subscription belonging to any of `userIds`,
 * skipping the "actor" (whoever caused the event — you never want to
 * notify yourself about your own action).
 *
 * `dedupeKey`, if provided, is stored in `notification_log` scoped to
 * `householdId`; if a row with the same (household, dedupe_key) already
 * exists this function returns immediately without sending, which is
 * the primary defense against re-notifying about a task-due-today
 * event on every cron tick. For fully-immediate one-off notifications
 * (e.g. a specific new expense) the caller can pass `expense:<id>`
 * anyway — it's still cheap insurance against a doubled request.
 *
 * Returns a summary object useful for tests and logging. Never throws
 * for individual push failures — a broken subscription must not break
 * the caller (e.g. the expense POST that triggered the notification).
 */
export async function notifyUsers(
  env: Env,
  {
    householdId,
    recipientUserIds,
    actorUserId,
    payload,
    dedupeKey,
  }: {
    householdId: string;
    recipientUserIds: string[];
    actorUserId?: string;
    payload: NotificationPayload;
    dedupeKey?: string;
  }
): Promise<{ sent: number; failed: number; expired: number; skipped: boolean }> {
  const vapid = readVapidConfig(env);
  if (!vapid) return { sent: 0, failed: 0, expired: 0, skipped: true };

  const recipients = recipientUserIds.filter(u => u && u !== actorUserId);
  if (!recipients.length) return { sent: 0, failed: 0, expired: 0, skipped: true };

  if (dedupeKey) {
    // INSERT OR IGNORE — the unique index on (household_id, dedupe_key)
    // makes a duplicate a silent no-op. We then detect "was this a first
    // insert?" by SELECTing the row's rowid we just would have written,
    // but SQLite's `changes()` isn't reliably exposed through D1's
    // interface, so we take the simpler approach: try to insert, and if
    // a row with this key already existed before our insert, bail.
    const already = await env.DB.prepare(
      'SELECT 1 FROM notification_log WHERE household_id = ? AND dedupe_key = ?'
    ).bind(householdId, dedupeKey).first();
    if (already) {
      return { sent: 0, failed: 0, expired: 0, skipped: true };
    }
    try {
      await env.DB.prepare(
        'INSERT INTO notification_log (id, household_id, dedupe_key) VALUES (?, ?, ?)'
      ).bind(crypto.randomUUID(), householdId, dedupeKey).run();
    } catch (e: any) {
      // If the unique constraint tripped between our SELECT and INSERT
      // (a concurrent request just wrote the same key), that's exactly
      // the case dedup exists to handle — treat it as "already sent."
      if (String(e?.message || '').includes('UNIQUE')) {
        return { sent: 0, failed: 0, expired: 0, skipped: true };
      }
      throw e;
    }
  }

  // Build a placeholder list for the IN (?, ?, ?...) clause.
  const placeholders = recipients.map(() => '?').join(', ');
  const rows = await env.DB.prepare(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions
     WHERE user_id IN (${placeholders})`
  ).bind(...recipients).all<SubscriptionRow>();

  const subs = rows.results || [];
  if (!subs.length) return { sent: 0, failed: 0, expired: 0, skipped: false };

  let sent = 0;
  let failed = 0;
  let expired = 0;

  const messageBody = {
    title: payload.title,
    body: payload.body,
    url: payload.url || '/',
    tag: payload.tag || 'peerson',
  };

  await Promise.all(subs.map(async row => {
    const sub: PushSubscriptionKeys = {
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
    };
    try {
      const res = await sendPush(sub, messageBody, vapid);
      if (res.ok) {
        sent++;
      } else if (res.expired) {
        expired++;
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?')
          .bind(row.id).run().catch(() => { /* best-effort */ });
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
      console.error('Push send threw for endpoint', row.endpoint, e);
    }
  }));

  return { sent, failed, expired, skipped: false };
}

/**
 * Convenience: notify every other member of a household. Runs the "who
 * are the other members?" lookup itself so callers who don't already
 * have the members list handy don't have to re-fetch it.
 */
export async function notifyOtherHouseholdMembers(
  env: Env,
  {
    householdId,
    actorUserId,
    payload,
    dedupeKey,
  }: {
    householdId: string;
    actorUserId?: string;
    payload: NotificationPayload;
    dedupeKey?: string;
  }
): Promise<{ sent: number; failed: number; expired: number; skipped: boolean }> {
  const members = await env.DB.prepare(
    'SELECT user_id FROM household_members WHERE household_id = ?'
  ).bind(householdId).all<{ user_id: string }>();
  const recipientUserIds = (members.results || []).map(m => m.user_id);
  return notifyUsers(env, {
    householdId,
    recipientUserIds,
    actorUserId,
    payload,
    dedupeKey,
  });
}
