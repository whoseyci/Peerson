import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';
import { requireMember } from '../../lib/auth';

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
  await env.DB.prepare(`
    INSERT INTO shopping_items (id, household_id, name, quantity, requested_by, linked_item_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, body.household_id, body.name || '', body.quantity || null, userId, body.linked_item_id || null).run();

  return Response.json({ item: { id, ...body } }, { status: 201 });
};
