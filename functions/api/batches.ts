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
  // location_id lets a batch sit somewhere different from its item's own
  // location_id (see schema.sql's doc comment on this column) -- e.g.
  // adding stock directly from the Rooms view defaults it to whichever
  // room/container the user was standing in. undefined (field omitted
  // entirely) means "inherit the item's location", matching every other
  // batch field's "omitted = don't care" convention throughout this file.
  const locationId = body.location_id !== undefined ? (body.location_id || null) : null;

  try {
    await env.DB.prepare(`
      INSERT INTO batches (id, item_id, quantity, expiry, barcode_code, grams_per_unit, price, location_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, body.item_id, body.quantity || 1, body.expiry || null, body.barcode_code || null, body.grams_per_unit || 0, price, locationId).run();
  } catch (e: any) {
    if (e?.message?.includes('no such column: location_id')) {
      try {
        await env.DB.prepare(`
          INSERT INTO batches (id, item_id, quantity, expiry, barcode_code, grams_per_unit, price)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(id, body.item_id, body.quantity || 1, body.expiry || null, body.barcode_code || null, body.grams_per_unit || 0, price).run();
      } catch (e2: any) {
        if (e2?.message?.includes('no such column: price')) {
          await env.DB.prepare(`
            INSERT INTO batches (id, item_id, quantity, expiry, barcode_code, grams_per_unit)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(id, body.item_id, body.quantity || 1, body.expiry || null, body.barcode_code || null, body.grams_per_unit || 0).run();
        } else {
          throw e2;
        }
      }
    } else {
      throw e;
    }
  }

  // Re-select the freshly inserted row rather than echoing back the
  // request body -- the body never carries server-assigned defaults like
  // date_added (DEFAULT (unixepoch())), so the previous `{ id, ...body }`
  // response silently returned date_added: undefined. src/views/inventory.ts
  // sorts batches by date_added (`.sort((a,b) => b.date_added - a.date_added)`)
  // to find the most recent price -- an undefined value there breaks that
  // comparison (NaN) until the next background sync poll re-fetched the
  // real row and fixed it up.
  const created = await env.DB.prepare('SELECT * FROM batches WHERE id = ?').bind(id).first();
  return Response.json({ batch: created }, { status: 201 });
};
