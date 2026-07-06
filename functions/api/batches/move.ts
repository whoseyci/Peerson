import { notifyHouseholdSync } from '../../durable/notifyHub';
import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../_middleware';

async function requireMember(db: D1Database, userId: string, householdId: string) {
  const row = await db.prepare('SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId).first();
  if (!row) throw new Error('Forbidden');
}

interface BatchRow {
  id: string;
  item_id: string;
  quantity: number;
  expiry: string | null;
  barcode_code: string | null;
  grams_per_unit: number;
  date_added: number;
  price: number | null;
  location_id: string | null;
}

// POST /api/batches/move -- moves `quantity` units of an item from one
// location to another, walking batches oldest-first (FIFO), exactly the
// same ordering removeOne()/the Rooms view's "-" stepper already use for
// consumption. This is deliberately a batch-level move, not a "delete N
// units here, create N units there" operation: each batch keeps its own
// expiry/price/barcode as it moves, and only the *specific* batch(es)
// needed to cover the requested quantity are touched -- a batch that's
// only partially consumed by the move gets split into two rows (the
// remainder staying at the old location, a new row created at the
// destination) rather than losing its per-batch expiry distinction.
//
// Body: { item_id, from_location_id: string | null, to_location_id: string | null, quantity: number }
// `from_location_id`/`to_location_id` of null means "no location assigned"
// (an item/batch with no location_id at all, not "inherit the item's
// location") -- consistent with how location_id already works elsewhere.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json<any>();

  const itemId = body.item_id as string | undefined;
  const quantity = Math.floor(Number(body.quantity));
  if (!itemId || !Number.isFinite(quantity) || quantity <= 0) {
    return new Response(JSON.stringify({ error: 'item_id and a positive quantity are required' }), { status: 400 });
  }
  const fromLocationId: string | null = body.from_location_id ?? null;
  const toLocationId: string | null = body.to_location_id ?? null;

  const item = await env.DB.prepare('SELECT household_id, location_id FROM items WHERE id = ?').bind(itemId).first();
  if (!item) return new Response(JSON.stringify({ error: 'Item not found' }), { status: 404 });
  await requireMember(env.DB, userId, item.household_id as string);

  if (toLocationId) {
    const dest = await env.DB.prepare('SELECT household_id FROM locations WHERE id = ?').bind(toLocationId).first();
    if (!dest || dest.household_id !== item.household_id) {
      return new Response(JSON.stringify({ error: 'Invalid to_location_id' }), { status: 400 });
    }
  }

  // A batch's *effective* location is its own location_id if set, else
  // the item's location_id (see Batch.location_id's doc comment in
  // src/types/index.ts) -- so "move everything currently at A" has to
  // match on that effective value, not the raw column, or batches that
  // were never explicitly relocated (the common case) would never be
  // found when A is the item's own location.
  const itemLocationId = (item.location_id as string | null) ?? null;
  const allBatches = await env.DB.prepare('SELECT * FROM batches WHERE item_id = ?')
    .bind(itemId).all();
  // Same FIFO ordering as src/utils/roomStock.ts's sortBatchesFifo() /
  // inventory.ts's pre-existing removeOne() sort -- duplicated here
  // (rather than imported) because this file lives under functions/ and
  // this project's test/build.test.ts explicitly forbids functions/**
  // importing from outside the functions tree (see that test's "no
  // external imports outside functions tree" check) to keep every Pages
  // Function independently deployable as its own bundle.
  const eligible = (allBatches.results as unknown as BatchRow[])
    .filter(b => (b.location_id ?? itemLocationId) === fromLocationId)
    .sort((a, b) => (a.expiry || '').localeCompare(b.expiry || ''));

  let remaining = quantity;
  let moved = 0;
  for (const batch of eligible) {
    if (remaining <= 0) break;
    if (batch.quantity <= remaining) {
      // The whole batch moves -- just repoint its location_id, keeping
      // its id/expiry/price/barcode intact (nothing else about it changed).
      await env.DB.prepare('UPDATE batches SET location_id = ? WHERE id = ?').bind(toLocationId, batch.id).run();
      remaining -= batch.quantity;
      moved += batch.quantity;
    } else {
      // Split: shrink the original batch in place (it keeps its own
      // expiry/location), and create a new batch row at the destination
      // carrying the same expiry/price/barcode for the moved portion.
      await env.DB.prepare('UPDATE batches SET quantity = ? WHERE id = ?').bind(batch.quantity - remaining, batch.id).run();
      const newId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO batches (id, item_id, quantity, expiry, barcode_code, grams_per_unit, price, location_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(newId, itemId, remaining, batch.expiry, batch.barcode_code, batch.grams_per_unit, batch.price, toLocationId).run();
      moved += remaining;
      remaining = 0;
    }
  }

  const refreshed = await env.DB.prepare('SELECT * FROM batches WHERE item_id = ?').bind(itemId).all();
  return Response.json({ moved, requested: quantity, batches: refreshed.results });
};
