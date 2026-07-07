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

  try {
    await requireMember(env.DB, userId, householdId);
  } catch {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const [
    household,
    members,
    items,
    batches,
    priceHistory,
    tasks,
    taskCompletions,
    expenses,
    expenseSplits,
    shoppingItems,
    locations,
    categoryBudgets,
  ] = await Promise.all([
    env.DB.prepare('SELECT * FROM households WHERE id = ?').bind(householdId).first(),
    env.DB.prepare(`
      SELECT u.id, u.name, hm.role, hm.joined_at
      FROM household_members hm
      JOIN users u ON hm.user_id = u.id
      WHERE hm.household_id = ?
      ORDER BY hm.joined_at ASC
    `).bind(householdId).all(),
    env.DB.prepare('SELECT * FROM items WHERE household_id = ? ORDER BY created_at DESC').bind(householdId).all(),
    env.DB.prepare(`
      SELECT b.* FROM batches b
      JOIN items i ON b.item_id = i.id
      WHERE i.household_id = ?
      ORDER BY b.date_added DESC
    `).bind(householdId).all(),
    env.DB.prepare(`
      SELECT iph.* FROM item_price_history iph
      JOIN items i ON iph.item_id = i.id
      WHERE i.household_id = ?
      ORDER BY iph.effective_from DESC
    `).bind(householdId).all(),
    env.DB.prepare('SELECT * FROM tasks WHERE household_id = ? ORDER BY created_at DESC').bind(householdId).all(),
    env.DB.prepare('SELECT * FROM task_completions WHERE household_id = ? ORDER BY completed_at DESC').bind(householdId).all(),
    env.DB.prepare('SELECT * FROM expenses WHERE household_id = ? ORDER BY created_at DESC').bind(householdId).all(),
    env.DB.prepare(`
      SELECT es.* FROM expense_splits es
      JOIN expenses e ON es.expense_id = e.id
      WHERE e.household_id = ?
    `).bind(householdId).all(),
    env.DB.prepare('SELECT * FROM shopping_items WHERE household_id = ? ORDER BY created_at DESC').bind(householdId).all(),
    env.DB.prepare('SELECT * FROM locations WHERE household_id = ? ORDER BY sort_order ASC, name ASC').bind(householdId).all(),
    env.DB.prepare('SELECT * FROM category_budgets WHERE household_id = ? ORDER BY category ASC').bind(householdId).all(),
  ]);

  return Response.json({
    exportedAt: new Date().toISOString(),
    household,
    members: members.results,
    items: items.results,
    batches: batches.results,
    priceHistory: priceHistory.results,
    tasks: tasks.results,
    taskCompletions: taskCompletions.results,
    expenses: expenses.results,
    expenseSplits: expenseSplits.results,
    shoppingItems: shoppingItems.results,
    locations: locations.results,
    categoryBudgets: categoryBudgets.results,
  });
};
