import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';

async function requireMember(db: D1Database, userId: string, householdId: string) {
  const row = await db.prepare('SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId).first();
  if (!row) throw new Error('Forbidden');
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  const householdId = new URL(request.url).searchParams.get('householdId') || request.headers.get('X-Household-Id');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  if (!householdId) return new Response(JSON.stringify({ error: 'householdId required' }), { status: 400 });

  try {
    await requireMember(env.DB, userId, householdId);
  } catch {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const configured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  let subscriptions: string[] = [];
  try {
    const res = await env.DB.prepare('SELECT endpoint FROM push_subscriptions WHERE user_id = ? AND household_id = ?')
      .bind(userId, householdId).all();
    subscriptions = (res.results || []).map((r: any) => r.endpoint);
  } catch (e: any) {
    if (!e?.message?.includes('no such table')) throw e;
  }

  return Response.json({
    configured,
    vapidPublicKey: configured ? (env.VAPID_PUBLIC_KEY || null) : null,
    subscriptions,
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return new Response(
      JSON.stringify({ error: 'Push notifications are not configured on the server (missing VAPID keys).' }),
      { status: 501 }
    );
  }

  const body = await request.json<any>();
  const householdId = body.household_id || request.headers.get('X-Household-Id');
  if (!householdId) return new Response(JSON.stringify({ error: 'household_id required' }), { status: 400 });

  try {
    await requireMember(env.DB, userId, householdId);
  } catch {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return new Response(JSON.stringify({ error: 'Missing endpoint or VAPID keys' }), { status: 400 });
  }

  try {
    const existing = await env.DB.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?')
      .bind(body.endpoint).first();
    if (existing) {
      await env.DB.prepare('UPDATE push_subscriptions SET user_id = ?, household_id = ?, p256dh = ?, auth = ? WHERE id = ?')
        .bind(userId, householdId, body.keys.p256dh, body.keys.auth, existing.id).run();
    } else {
      const id = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO push_subscriptions (id, user_id, household_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, userId, householdId, body.endpoint, body.keys.p256dh, body.keys.auth).run();
    }
  } catch (e: any) {
    if (e?.message?.includes('no such table')) {
      return new Response(JSON.stringify({ error: 'Database table push_subscriptions not created yet' }), { status: 500 });
    }
    throw e;
  }

  return Response.json({ success: true });
};
