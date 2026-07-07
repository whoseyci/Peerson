import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';
import { requireMember } from '../auth';


async function lastModified(env: Env, householdId: string) {
  try {
    return await env.DB.prepare(`
      SELECT MAX(ts) as last_mod FROM (
        SELECT MAX(created_at) as ts FROM items WHERE household_id = ?
        UNION ALL
        SELECT MAX(date_added) as ts FROM batches WHERE item_id IN (SELECT id FROM items WHERE household_id = ?)
        UNION ALL
        SELECT MAX(consumed_at) as ts FROM batches WHERE item_id IN (SELECT id FROM items WHERE household_id = ?)
        UNION ALL
        SELECT MAX(created_at) as ts FROM tasks WHERE household_id = ?
        UNION ALL
        SELECT MAX(created_at) as ts FROM expenses WHERE household_id = ?
        UNION ALL
        SELECT MAX(created_at) as ts FROM shopping_items WHERE household_id = ?
      )
    `).bind(householdId, householdId, householdId, householdId, householdId, householdId).first();
  } catch (e: any) {
    if (!e?.message?.includes('no such column: consumed_at')) throw e;
    return await env.DB.prepare(`
      SELECT MAX(ts) as last_mod FROM (
        SELECT MAX(created_at) as ts FROM items WHERE household_id = ?
        UNION ALL
        SELECT MAX(date_added) as ts FROM batches WHERE item_id IN (SELECT id FROM items WHERE household_id = ?)
        UNION ALL
        SELECT MAX(created_at) as ts FROM tasks WHERE household_id = ?
        UNION ALL
        SELECT MAX(created_at) as ts FROM expenses WHERE household_id = ?
        UNION ALL
        SELECT MAX(created_at) as ts FROM shopping_items WHERE household_id = ?
      )
    `).bind(householdId, householdId, householdId, householdId, householdId).first();
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  const householdId = new URL(request.url).searchParams.get('householdId');
  if (!userId || !householdId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  await requireMember(env.DB, userId, householdId);

  const q = await lastModified(env, householdId);
  return Response.json({ lastModified: q?.last_mod || 0 });
};
