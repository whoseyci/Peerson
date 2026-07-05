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

  const batch = await env.DB.prepare('SELECT b.*, i.household_id FROM batches b JOIN items i ON b.item_id = i.id WHERE b.id = ?').bind(id).first();
  if (!batch) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await requireMember(env.DB, userId, batch.household_id as string);

  if (body.quantity !== undefined) {
    await env.DB.prepare('UPDATE batches SET quantity = ? WHERE id = ?').bind(Math.max(0, body.quantity), id).run();
  }
  if (body.expiry !== undefined) {
    await env.DB.prepare('UPDATE batches SET expiry = ? WHERE id = ?').bind(body.expiry, id).run();
  }
  if (body.price !== undefined) {
    const price = body.price !== null ? parseFloat(body.price) || null : null;
    await env.DB.prepare('UPDATE batches SET price = ? WHERE id = ?').bind(price, id).run();
  }
  const updated = await env.DB.prepare('SELECT * FROM batches WHERE id = ?').bind(id).first();
  return Response.json({ batch: updated });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const id = String(params.id);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const batch = await env.DB.prepare('SELECT b.*, i.household_id FROM batches b JOIN items i ON b.item_id = i.id WHERE b.id = ?').bind(id).first();
  if (!batch) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await requireMember(env.DB, userId, batch.household_id as string);
  await env.DB.prepare('DELETE FROM batches WHERE id = ?').bind(id).run();
  return Response.json({ success: true });
};
