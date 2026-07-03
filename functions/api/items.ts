import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';
import { requireMember } from '../../lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  const householdId = new URL(request.url).searchParams.get('householdId');
  if (!userId || !householdId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  await requireMember(env.DB, userId, householdId);

  const items = await env.DB.prepare('SELECT * FROM items WHERE household_id = ? ORDER BY name')
    .bind(householdId).all();
  const batches = await env.DB.prepare('SELECT * FROM batches WHERE item_id IN (SELECT id FROM items WHERE household_id = ?)')
    .bind(householdId).all();
  return Response.json({ items: items.results, batches: batches.results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json<any>();
  if (!body.household_id) return new Response(JSON.stringify({ error: 'household_id required' }), { status: 400 });
  await requireMember(env.DB, userId, body.household_id);

  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO items (id, household_id, name, category, icon, threshold, location, barcodes, nutrition, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, body.household_id, body.name || '', body.category || 'sonstiges', body.icon || null,
    body.threshold || 0, body.location || '', JSON.stringify(body.barcodes || []), JSON.stringify(body.nutrition || {}), userId
  ).run();

  const item = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  return Response.json({ item }, { status: 201 });
};
