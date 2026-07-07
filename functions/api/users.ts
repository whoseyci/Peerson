import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';
import { jsonError } from '../http';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return jsonError(401, 'Unauthorized');

  const body = await request.json<{ action?: string; name?: string; target_user_id?: string; user_id?: string; userId?: string }>();
  const db = env.DB;

  if (body.action === 'update_name' && body.name) {
    await db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(body.name.trim(), userId).run();
    return Response.json({ success: true });
  }

  if (body.action === 'delete_account') {
    if ((body.target_user_id && body.target_user_id !== userId) ||
        (body.user_id && body.user_id !== userId) ||
        (body.userId && body.userId !== userId)) {
      return jsonError(403, 'Forbidden: cannot delete another user');
    }

    await db.prepare("UPDATE users SET name = ? WHERE id = ?").bind('Gelöschter Nutzer', userId).run();
    await db.prepare("DELETE FROM household_members WHERE user_id = ?").bind(userId).run();

    try {
      await db.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").bind(userId).run();
    } catch (e: any) {
      if (!e?.message?.includes('no such table')) throw e;
    }

    return Response.json({ success: true });
  }

  return jsonError(400, 'Bad request');
};
