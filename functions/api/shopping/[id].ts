import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../_middleware';

async function requireMember(db: D1Database, userId: string, householdId: string) {
  const row = await db.prepare('SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId).first();
  if (!row) throw new Error('Forbidden');
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const id = String(params.id);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json<any>();

  const existing = await env.DB.prepare('SELECT * FROM shopping_items WHERE id = ?').bind(id).first();
  if (!existing) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await requireMember(env.DB, userId, existing.household_id as string);

  const fields: string[] = [];
  const values: any[] = [];
  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
  if (body.quantity !== undefined) { fields.push('quantity = ?'); values.push(body.quantity); }
  if (body.status !== undefined) { fields.push('status = ?'); values.push(body.status); }
  if (fields.length === 0) return Response.json({ item: existing });

  values.push(id);
  await env.DB.prepare(`UPDATE shopping_items SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  const item = await env.DB.prepare('SELECT * FROM shopping_items WHERE id = ?').bind(id).first();
  return Response.json({ item });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const id = String(params.id);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const existing = await env.DB.prepare('SELECT * FROM shopping_items WHERE id = ?').bind(id).first();
  if (!existing) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await requireMember(env.DB, userId, existing.household_id as string);
  await env.DB.prepare('DELETE FROM shopping_items WHERE id = ?').bind(id).run();
  return Response.json({ success: true });
};
