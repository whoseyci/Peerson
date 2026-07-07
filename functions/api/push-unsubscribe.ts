import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const body = await request.json<{ endpoint?: string }>();
  if (!body.endpoint) return new Response(JSON.stringify({ error: 'endpoint required' }), { status: 400 });

  try {
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
      .bind(userId, body.endpoint).run();
  } catch (e: any) {
    if (!e?.message?.includes('no such table')) throw e;
  }

  return Response.json({ success: true });
};
