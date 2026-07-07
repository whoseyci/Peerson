import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env as BaseEnv } from '../_middleware';
import { readVapidConfig, type PushEnv } from './_pushLib';

export interface Env extends BaseEnv, PushEnv {}

async function requireMember(db: D1Database, userId: string, householdId: string): Promise<boolean> {
  const row = await db.prepare(
    'SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?'
  ).bind(householdId, userId).first();
  return !!row;
}

/**
 * POST /api/push-subscribe
 * Body: { endpoint: string, keys: { p256dh: string, auth: string } }
 * Auth: X-User-Id + X-Household-Id headers (standard pattern from
 *       functions/api/tasks.ts).
 *
 * Upserts a row in `push_subscriptions`. The unique index on
 * (user_id, endpoint) means calling subscribe repeatedly with the same
 * endpoint just refreshes the keys instead of piling up duplicates.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!readVapidConfig(env)) {
    // Consistent with functions/api/bug-report.ts / receipt-scan.ts:
    // graceful 501 when the optional feature is not configured.
    return new Response(
      JSON.stringify({ error: 'Push notifications are not configured on the server (missing VAPID keys).' }),
      { status: 501 }
    );
  }

  const userId = request.headers.get('X-User-Id');
  const householdId = request.headers.get('X-Household-Id');
  if (!userId || !householdId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  if (!(await requireMember(env.DB, userId, householdId))) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return new Response(
      JSON.stringify({ error: 'endpoint, keys.p256dh, and keys.auth are required' }),
      { status: 400 }
    );
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ?'
  ).bind(userId, endpoint).first<{ id: string }>();

  if (existing) {
    // Same device re-subscribing. Refresh keys + move it under the
    // current household in case the user has switched households on the
    // same browser (household_id is per-subscription so notifications
    // for the wrong household don't leak to a device that no longer
    // belongs to it).
    await env.DB.prepare(
      'UPDATE push_subscriptions SET p256dh = ?, auth = ?, household_id = ? WHERE id = ?'
    ).bind(p256dh, auth, householdId, existing.id).run();
    return Response.json({ id: existing.id, updated: true });
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (id, user_id, household_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, householdId, endpoint, p256dh, auth).run();

  return Response.json({ id, updated: false }, { status: 201 });
};
