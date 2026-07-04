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

  const expenses = await env.DB.prepare('SELECT * FROM expenses WHERE household_id = ? ORDER BY created_at DESC')
    .bind(householdId).all();
  const splits = await env.DB.prepare(`
    SELECT es.* FROM expense_splits es
    JOIN expenses e ON es.expense_id = e.id
    WHERE e.household_id = ?
  `).bind(householdId).all();
  const members = await env.DB.prepare(`
    SELECT u.id, u.name FROM household_members hm
    JOIN users u ON hm.user_id = u.id
    WHERE hm.household_id = ?
  `).bind(householdId).all();

  const balances: Record<string, number> = {};
  members.results.forEach((m: any) => balances[m.id] = 0);
  (expenses.results as any[]).forEach((e: any) => {
    balances[e.paid_by] = (balances[e.paid_by] || 0) + e.amount;
  });
  (splits.results as any[]).forEach((s: any) => {
    balances[s.user_id] = (balances[s.user_id] || 0) - s.amount;
  });

  return Response.json({ expenses: expenses.results, splits: splits.results, members: members.results, balances });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json<any>();
  if (!body.household_id) return new Response(JSON.stringify({ error: 'household_id required' }), { status: 400 });
  await requireMember(env.DB, userId, body.household_id);

  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO expenses (id, household_id, title, amount, paid_by, split_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, body.household_id, body.title || '', body.amount || 0, body.paid_by || userId, body.split_type || 'equal').run();

  if (body.splits && Array.isArray(body.splits)) {
    for (const s of body.splits) {
      await env.DB.prepare(`
        INSERT INTO expense_splits (id, expense_id, user_id, amount)
        VALUES (?, ?, ?, ?)
      `).bind(crypto.randomUUID(), id, s.user_id, s.amount).run();
    }
  }

  return Response.json({ expense: { id, ...body } }, { status: 201 });
};
