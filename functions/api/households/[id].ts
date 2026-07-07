import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../_middleware';
import { requireMember } from '../../auth';
import { jsonError } from '../../http';

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const householdId = String(params.id);
  if (!userId) return jsonError(401, 'Unauthorized');

  const db = env.DB;
  await requireMember(db, userId, householdId);

  const body = await request.json<{ invite_code?: string }>();
  if (body.invite_code === 'regenerate') {
    const newCode = generateCode();
    await db.prepare('UPDATE households SET invite_code = ? WHERE id = ?').bind(newCode, householdId).run();
    return Response.json({ invite_code: newCode });
  }

  return jsonError(400, 'Bad request');
};
