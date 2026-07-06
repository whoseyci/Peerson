import { notifyHouseholdSync } from '../durable/notifyHub';
import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';

async function requireMember(db: D1Database, userId: string, householdId: string) {
  const row = await db.prepare('SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId).first();
  if (!row) throw new Error('Forbidden');
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  const householdId = new URL(request.url).searchParams.get('householdId');
  if (!userId || !householdId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  await requireMember(env.DB, userId, householdId);
  const items = await env.DB.prepare('SELECT * FROM shopping_items WHERE household_id = ? ORDER BY created_at DESC')
    .bind(householdId).all();
  return Response.json({ items: items.results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json<any>();
  if (!body.household_id) return new Response(JSON.stringify({ error: 'household_id required' }), { status: 400 });
  await requireMember(env.DB, userId, body.household_id);

  const id = crypto.randomUUID();
  const price = body.price !== undefined && body.price !== null ? parseFloat(body.price) || null : null;
  try {
    await env.DB.prepare(`
      INSERT INTO shopping_items (id, household_id, name, quantity, requested_by, linked_item_id, price)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, body.household_id, body.name || '', body.quantity || null, userId, body.linked_item_id || null, price).run();
  } catch (e: any) {
    if (e?.message?.includes('no such column: price')) {
      await env.DB.prepare(`
        INSERT INTO shopping_items (id, household_id, name, quantity, requested_by, linked_item_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(id, body.household_id, body.name || '', body.quantity || null, userId, body.linked_item_id || null).run();
    } else {
      throw e;
    }
  }

  // Re-select the freshly inserted row rather than echoing back the
  // request body -- the body never carries server-assigned defaults like
  // status ('open', DB default) or created_at (DEFAULT (unixepoch())), so
  // the previous `{ id, ...body, price }` response silently omitted both
  // until the next background sync poll re-fetched the real row.
  const created = await env.DB.prepare('SELECT * FROM shopping_items WHERE id = ?').bind(id).first();
  return Response.json({ item: created }, { status: 201 });
};
