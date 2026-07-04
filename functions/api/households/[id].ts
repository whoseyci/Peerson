import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../_middleware';

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}
async function requireMember(db: D1Database, userId: string, householdId: string) {
  const row = await db.prepare('SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId).first();
  if (!row) throw new Error('Forbidden');
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const householdId = String(params.id);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = env.DB;
  await requireMember(db, userId, householdId);

  const body = await request.json<{ invite_code?: string }>();
  if (body.invite_code === 'regenerate') {
    const newCode = generateCode();
    await db.prepare('UPDATE households SET invite_code = ? WHERE id = ?').bind(newCode, householdId).run();
    return Response.json({ invite_code: newCode });
  }

  return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 });
};
