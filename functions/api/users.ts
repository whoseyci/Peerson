import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const body = await request.json<{ action?: string; name?: string }>();
  const db = env.DB;

  if (body.action === 'update_name' && body.name) {
    await db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(body.name.trim(), userId).run();
    return Response.json({ success: true });
  }

  return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 });
};
