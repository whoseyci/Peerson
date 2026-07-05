import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';

async function requireMember(db: D1Database, userId: string, householdId: string) {
  const row = await db.prepare('SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId).first();
  if (!row) throw new Error('Forbidden');
}

// D1 (SQLite) has no native JSON column type: `items.barcodes` and
// `items.nutrition` are stored as TEXT columns holding `JSON.stringify(...)`
// output (see onRequestPost below). `SELECT *` returns those columns as raw
// strings -- D1 never auto-parses them. The frontend types (src/types/index.ts)
// declare `Item.barcodes: Barcode[]` and `Item.nutrition: Record<string, number>`,
// i.e. real arrays/objects are expected, not JSON strings.
//
// Bug confirmed with an automated regression test (test/items-json-fields.test.ts)
// using the project's MockD1Database, which -- like real D1 -- stores exactly
// what is bound with no auto-parsing: a raw `SELECT * FROM items` row had
// `typeof row.barcodes === 'string'`, and that string survived unparsed all
// the way through `Response.json(...)`. This helper repairs that before any
// row leaves the API boundary. (Duplicated in functions/api/items/[id].ts --
// this project's own build.test.ts enforces "no external imports outside the
// functions tree" via a substring check on `lib/`, so a shared functions/lib
// module isn't viable here; the helper is tiny enough that duplication is the
// simplest fix that respects that existing test's intent.)
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

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  const householdId = new URL(request.url).searchParams.get('householdId');
  if (!userId || !householdId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  await requireMember(env.DB, userId, householdId);

  const items = await env.DB.prepare('SELECT * FROM items WHERE household_id = ? ORDER BY name')
    .bind(householdId).all();
  const batches = await env.DB.prepare('SELECT * FROM batches WHERE item_id IN (SELECT id FROM items WHERE household_id = ?)')
    .bind(householdId).all();
  return Response.json({ items: items.results.map(parseItemRow), batches: batches.results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json<any>();
  if (!body.household_id) return new Response(JSON.stringify({ error: 'household_id required' }), { status: 400 });
  await requireMember(env.DB, userId, body.household_id);

  let locationId: string | null = body.location_id || null;
  if (locationId) {
    const loc = await env.DB.prepare('SELECT household_id FROM locations WHERE id = ?').bind(locationId).first();
    if (!loc || loc.household_id !== body.household_id) locationId = null;
  }
  const priceCents = body.price_cents === null || body.price_cents === undefined
    ? null
    : Math.max(0, Math.round(body.price_cents));

  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO items (id, household_id, name, category, icon, threshold, location, location_id, barcodes, nutrition, price_cents, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, body.household_id, body.name || '', body.category || 'sonstiges', body.icon || null,
    body.threshold || 0, body.location || '', locationId, JSON.stringify(body.barcodes || []),
    JSON.stringify(body.nutrition || {}), priceCents, userId
  ).run();

  const item = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  return Response.json({ item: item ? parseItemRow(item as any) : item }, { status: 201 });
};
