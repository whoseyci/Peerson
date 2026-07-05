import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../_middleware';

async function requireMember(db: D1Database, userId: string, householdId: string) {
  const row = await db.prepare('SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId).first();
  if (!row) throw new Error('Forbidden');
}

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
  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
  if (body.category !== undefined) { fields.push('category = ?'); values.push(body.category); }
  if (body.icon !== undefined) { fields.push('icon = ?'); values.push(body.icon); }
  if (body.threshold !== undefined) { fields.push('threshold = ?'); values.push(body.threshold); }
  if (body.location !== undefined) { fields.push('location = ?'); values.push(body.location); }
  if (body.barcodes !== undefined) { fields.push('barcodes = ?'); values.push(JSON.stringify(body.barcodes)); }
  if (body.nutrition !== undefined) { fields.push('nutrition = ?'); values.push(JSON.stringify(body.nutrition)); }
  // NOTE: `existing` is a raw D1 row -- barcodes/nutrition are still JSON TEXT
  // here. Parse it before returning it as the no-op response below.
  if (fields.length === 0) return Response.json({ item: parseItemRow(existing as any) });

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
