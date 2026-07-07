import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env as BaseEnv } from '../_middleware';

export interface Env extends BaseEnv {}

/**
 * POST /api/push-unsubscribe
 * Body: { endpoint: string }
 * Auth: X-User-Id header (no household check needed — a user can only
 *       remove their own subscription rows).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: { endpoint?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }
  if (!body.endpoint) {
    return new Response(JSON.stringify({ error: 'endpoint required' }), { status: 400 });
  }

  await env.DB.prepare(
    'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?'
  ).bind(userId, body.endpoint).run();

  return Response.json({ success: true });
};
