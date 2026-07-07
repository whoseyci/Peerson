import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';

const DELETED_USER_NAME = 'Gelöschter Nutzer';

async function deletePushSubscriptionsIfPresent(db: D1Database, userId: string) {
  try {
    await db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').bind(userId).run();
  } catch (e: any) {
    // Push notifications are optional and may not have landed/migrated yet.
    // Account deletion must not fail just because that optional table does not exist.
    if (!String(e?.message || '').includes('no such table')) throw e;
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const body = await request.json<{ action?: string; name?: string; target_user_id?: string }>();
  const db = env.DB;

  if (body.action === 'update_name' && body.name) {
    await db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(body.name.trim(), userId).run();
    return Response.json({ success: true });
  }

  if (body.action === 'delete_account') {
    if (body.target_user_id && body.target_user_id !== userId) {
      return new Response(JSON.stringify({ error: 'Cannot delete another user' }), { status: 403 });
    }

    // Chosen GDPR baseline: anonymize the user record, do not cascade-delete
    // shared household history. Expenses, tasks, items, and shopping entries may
    // still reference this stable random id, preserving balances and audit trails
    // for remaining household members without retaining the user's display name.
    await db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(DELETED_USER_NAME, userId).run();
    await db.prepare('DELETE FROM household_members WHERE user_id = ?').bind(userId).run();
    await deletePushSubscriptionsIfPresent(db, userId);

    return Response.json({ success: true, anonymized: true });
  }

  return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 });
};
