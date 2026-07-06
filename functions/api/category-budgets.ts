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

  const budgets = await env.DB.prepare('SELECT * FROM category_budgets WHERE household_id = ? ORDER BY category')
    .bind(householdId).all();
  return Response.json({ budgets: budgets.results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json<any>();
  if (!body.household_id) return new Response(JSON.stringify({ error: 'household_id required' }), { status: 400 });
  const category = (body.category || '').trim().toLowerCase();
  if (!category) return new Response(JSON.stringify({ error: 'category required' }), { status: 400 });
  if (category === 'settlement') return new Response(JSON.stringify({ error: 'Cannot set budget for settlement category' }), { status: 400 });
  await requireMember(env.DB, userId, body.household_id);

  const amount = body.monthly_amount !== undefined && body.monthly_amount !== null ? parseFloat(body.monthly_amount) : null;
  if (amount === null || isNaN(amount) || amount <= 0) {
    await env.DB.prepare('DELETE FROM category_budgets WHERE household_id = ? AND category = ?')
      .bind(body.household_id, category).run();
    return Response.json({ budget: null, deleted: true });
  }

  const existing = await env.DB.prepare('SELECT id FROM category_budgets WHERE household_id = ? AND category = ?')
    .bind(body.household_id, category).first();

  if (existing) {
    await env.DB.prepare('UPDATE category_budgets SET monthly_amount = ? WHERE id = ?')
      .bind(amount, existing.id).run();
    const updated = await env.DB.prepare('SELECT * FROM category_budgets WHERE id = ?').bind(existing.id).first();
    return Response.json({ budget: updated });
  }

  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO category_budgets (id, household_id, category, monthly_amount) VALUES (?, ?, ?, ?)')
    .bind(id, body.household_id, category, amount).run();
  const budget = await env.DB.prepare('SELECT * FROM category_budgets WHERE id = ?').bind(id).first();
  return Response.json({ budget }, { status: 201 });
};
