import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../_middleware';
import { requireMember } from '../../auth';


// See functions/api/items.ts for the full write-up of this bug: `barcodes`
// and `nutrition` are JSON-stringified TEXT columns in D1 and are never
// auto-parsed by `SELECT *`. Duplicated here (rather than a shared
// functions/lib module) because test/build.test.ts enforces "no external
// imports outside the functions tree" via a substring check on `lib/`.
function parseItemRow<T extends { barcodes?: unknown; nutrition?: unknown }>(row: T): T {
  return {
    ...row,
    barcodes: typeof row.barcodes === 'string' ? safeJsonParse(row.barcodes, []) : (row.barcodes ?? []),
    nutrition: typeof row.nutrition === 'string' ? safeJsonParse(row.nutrition, {}) : (row.nutrition ?? {}),
  };
}

function safeJsonParse(value: string, fallback: unknown) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const id = String(params.id);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json<any>();

  const existing = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  if (!existing) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await requireMember(env.DB, userId, existing.household_id as string);

  const fields: string[] = [];
  const values: any[] = [];
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return new Response(JSON.stringify({ error: 'name cannot be empty' }), { status: 400 });
    fields.push('name = ?');
    values.push(name);
  }
  if (body.category !== undefined) { fields.push('category = ?'); values.push(body.category); }
  if (body.icon !== undefined) { fields.push('icon = ?'); values.push(body.icon); }
  if (body.threshold !== undefined) { fields.push('threshold = ?'); values.push(body.threshold); }
  if (body.location !== undefined) { fields.push('location = ?'); values.push(body.location); }
  if (body.location_id !== undefined) {
    const locationId = body.location_id || null;
    if (locationId) {
      // Must belong to the same household -- otherwise a buggy/malicious
      // client could point an item at another household's location tree.
      const loc = await env.DB.prepare('SELECT household_id FROM locations WHERE id = ?').bind(locationId).first();
      if (!loc || loc.household_id !== existing.household_id) {
        return new Response(JSON.stringify({ error: 'Invalid location_id' }), { status: 400 });
      }
    }
    fields.push('location_id = ?');
    values.push(locationId);
  }
  if (body.barcodes !== undefined) { fields.push('barcodes = ?'); values.push(JSON.stringify(body.barcodes)); }
  if (body.nutrition !== undefined) { fields.push('nutrition = ?'); values.push(JSON.stringify(body.nutrition)); }

  // Price history: items.price_cents always holds the *current* price. We
  // only ever append to item_price_history when the price actually
  // *changes* -- the old price gets stamped with effective_until and
  // becomes an immutable record, rather than inserting one row per save
  // regardless of whether the number moved. This is what lets a household
  // see "price went from X to Y on this date" (inflation tracking) without
  // the history table growing on every no-op edit.
  let priceChanged = false;
  if (body.price_cents !== undefined) {
    const newPrice = body.price_cents === null ? null : Math.max(0, Math.round(body.price_cents));
    const oldPrice = existing.price_cents as number | null;
    if (newPrice !== oldPrice) {
      priceChanged = true;
      fields.push('price_cents = ?');
      values.push(newPrice);
    }
  }

  // NOTE: `existing` is a raw D1 row -- barcodes/nutrition are still JSON TEXT
  // here. Parse it before returning it as the no-op response below.
  if (fields.length === 0) return Response.json({ item: parseItemRow(existing as any) });

  if (priceChanged && existing.price_cents !== null && existing.price_cents !== undefined) {
    // The *old* price becomes a closed history entry. Its effective_from is
    // whenever it actually became the current price -- i.e. the
    // effective_until of the most recent prior history entry, or the
    // item's creation time if this is the first price change ever. This
    // keeps the history a gapless timeline (each entry's effective_until
    // equals the next entry's effective_from) instead of guessing/duplicating
    // timestamps.
    const now = Math.floor(Date.now() / 1000);
    // Fetched as .all() + JS max() rather than "ORDER BY ... DESC LIMIT 1"
    // so this works against both real D1 and the project's simplified
    // test-mock DB (test/mocks/d1.ts), which doesn't parse ORDER BY/LIMIT.
    // Price-history rows per item are always a handful, so this is cheap.
    const priorEntries = await env.DB.prepare(
      'SELECT effective_until FROM item_price_history WHERE item_id = ?'
    ).bind(id).all<{ effective_until: number }>();
    const latestPriorUntil = priorEntries.results.length
      ? Math.max(...priorEntries.results.map(r => r.effective_until))
      : null;
    const effectiveFrom = latestPriorUntil ?? (existing.created_at as number) ?? now;

    await env.DB.prepare(
      'INSERT INTO item_price_history (id, item_id, price_cents, effective_from, effective_until) VALUES (?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), id, existing.price_cents, effectiveFrom, now).run();
  }


  values.push(id);
  await env.DB.prepare(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  const item = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  return Response.json({ item: item ? parseItemRow(item as any) : item });
};


export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const id = String(params.id);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const existing = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  if (!existing) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await requireMember(env.DB, userId, existing.household_id as string);
  await env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id).run();
  return Response.json({ success: true });
};
