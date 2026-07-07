import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';
import { requireMember } from '../auth';
import { jsonError } from '../http';

const BUDGETABLE_CATEGORIES = new Set(['groceries', 'rent', 'household', 'leisure', 'sonstiges']);


function validateCategory(category: unknown) {
  const value = String(category || '').trim();
  return BUDGETABLE_CATEGORIES.has(value) ? value : null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  const householdId = new URL(request.url).searchParams.get('householdId');
  if (!userId || !householdId) return jsonError(401, 'Unauthorized');
  await requireMember(env.DB, userId, householdId);

  const budgets = await env.DB.prepare('SELECT * FROM category_budgets WHERE household_id = ? ORDER BY category')
    .bind(householdId).all();
  return Response.json({ budgets: budgets.results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return jsonError(401, 'Unauthorized');
  const body = await request.json<any>();
  if (!body.household_id) return jsonError(400, 'household_id required');
  await requireMember(env.DB, userId, body.household_id);

  const category = validateCategory(body.category);
  if (!category) return jsonError(400, 'invalid category');
  const monthlyAmount = Number(body.monthly_amount);
  if (!Number.isFinite(monthlyAmount) || monthlyAmount <= 0) {
    return jsonError(400, 'monthly_amount must be positive');
  }

  const existing = await env.DB.prepare('SELECT id FROM category_budgets WHERE household_id = ? AND category = ?')
    .bind(body.household_id, category).first();
  if (existing?.id) {
    await env.DB.prepare('UPDATE category_budgets SET monthly_amount = ? WHERE id = ?')
      .bind(monthlyAmount, existing.id).run();
  } else {
    await env.DB.prepare('INSERT INTO category_budgets (id, household_id, category, monthly_amount) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), body.household_id, category, monthlyAmount).run();
  }

  const budget = await env.DB.prepare('SELECT * FROM category_budgets WHERE household_id = ? AND category = ?')
    .bind(body.household_id, category).first();
  return Response.json({ budget }, { status: existing?.id ? 200 : 201 });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  const url = new URL(request.url);
  const householdId = url.searchParams.get('householdId');
  const category = validateCategory(url.searchParams.get('category'));
  if (!userId || !householdId) return jsonError(401, 'Unauthorized');
  if (!category) return jsonError(400, 'invalid category');
  await requireMember(env.DB, userId, householdId);

  await env.DB.prepare('DELETE FROM category_budgets WHERE household_id = ? AND category = ?')
    .bind(householdId, category).run();
  return Response.json({ success: true });
};
