import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';

async function requireMember(db: D1Database, userId: string, householdId: string) {
  const row = await db.prepare('SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId).first();
  if (!row) throw new Error('Forbidden');
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json<any>();
  const item = await env.DB.prepare('SELECT household_id FROM items WHERE id = ?').bind(body.item_id).first();
  if (!item) return new Response(JSON.stringify({ error: 'Item not found' }), { status: 404 });
  await requireMember(env.DB, userId, item.household_id as string);

  const id = crypto.randomUUID();
  const price = body.price !== undefined && body.price !== null ? parseFloat(body.price) || null : null;
  
  try {
    await env.DB.prepare(`
      INSERT INTO batches (id, item_id, quantity, expiry, barcode_code, grams_per_unit, price)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, body.item_id, body.quantity || 1, body.expiry || null, body.barcode_code || null, body.grams_per_unit || 0, price).run();
  } catch (e: any) {
    if (e?.message?.includes('no such column: price')) {
      await env.DB.prepare(`
        INSERT INTO batches (id, item_id, quantity, expiry, barcode_code, grams_per_unit)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(id, body.item_id, body.quantity || 1, body.expiry || null, body.barcode_code || null, body.grams_per_unit || 0).run();
    } else {
      throw e;
    }
  }

  return Response.json({ batch: { id, ...body, price } }, { status: 201 });
};
