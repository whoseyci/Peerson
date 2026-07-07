import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';
import { requireMember } from '../auth';
import { jsonError } from '../http';
import { signRealtimeToken } from '../realtime-auth';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  const userName = request.headers.get('X-User-Name') || 'Anonymous';
  const householdId = request.headers.get('X-Household-Id');
  const clientId = request.headers.get('X-Client-Id');
  if (!userId || !householdId || !clientId) return jsonError(401, 'Unauthorized');
  if (!env.REALTIME_TOKEN_SECRET) return jsonError(501, 'REALTIME_TOKEN_SECRET not configured');
  await requireMember(env.DB, userId, householdId);
  const exp = Math.floor(Date.now() / 1000) + 10 * 60;
  const token = await signRealtimeToken(env.REALTIME_TOKEN_SECRET, { userId, userName, householdId, clientId, exp });
  return Response.json({ token, exp, wsUrl: env.REALTIME_WS_URL || null });
};
