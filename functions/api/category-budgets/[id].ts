import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../_middleware';

async function requireMember(db: D1Database, userId: string, householdId: string) {
  const row = await db.prepare('SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId).first();
  if (!row) throw new Error('Forbidden');
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const idOrCategory = decodeURIComponent(String(params.id));
  const householdId = new URL(request.url).searchParams.get('householdId');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const existing = await env.DB.prepare('SELECT * FROM category_budgets WHERE id = ? OR (household_id = ? AND category = ?)')
    .bind(idOrCategory, householdId || '', idOrCategory).first();
  if (!existing) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await requireMember(env.DB, userId, existing.household_id as string);

  await env.DB.prepare('DELETE FROM category_budgets WHERE id = ?').bind(existing.id).run();
  return Response.json({ success: true });
};
