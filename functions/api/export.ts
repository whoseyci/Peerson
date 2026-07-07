import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';

async function requireMember(db: D1Database, userId: string, householdId: string) {
  const row = await db.prepare('SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId).first();
  if (!row) throw new Error('Forbidden');
}

function safeJsonParse(value: string, fallback: unknown) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function parseItemRow<T extends { barcodes?: unknown; nutrition?: unknown }>(row: T): T {
  return {
    ...row,
    barcodes: typeof row.barcodes === 'string' ? safeJsonParse(row.barcodes, []) : (row.barcodes ?? []),
    nutrition: typeof row.nutrition === 'string' ? safeJsonParse(row.nutrition, {}) : (row.nutrition ?? {}),
  };
}

function parseTaskRow<T extends { rotation_users?: unknown; subtasks?: unknown }>(row: T): T {
  return {
    ...row,
    rotation_users: typeof row.rotation_users === 'string' ? safeJsonParse(row.rotation_users, null) : (row.rotation_users ?? null),
    subtasks: typeof row.subtasks === 'string' ? safeJsonParse(row.subtasks, null) : (row.subtasks ?? null),
  };
}

async function safeQueryAll(db: D1Database, query: string, ...binds: any[]) {
  try {
    const stmt = db.prepare(query);
    const res = await (binds.length > 0 ? stmt.bind(...binds) : stmt).all();
    return res.results || [];
  } catch (e: any) {
    if (e?.message?.includes('no such table')) return [];
    throw e;
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  const householdId = new URL(request.url).searchParams.get('householdId');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  if (!householdId) return new Response(JSON.stringify({ error: 'householdId required' }), { status: 400 });

  try {
    await requireMember(env.DB, userId, householdId);
  } catch {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const db = env.DB;
  const household = await db.prepare('SELECT * FROM households WHERE id = ?').bind(householdId).first();
  const members = await safeQueryAll(db, `
    SELECT u.id, u.name, hm.role, hm.joined_at
    FROM household_members hm
    JOIN users u ON hm.user_id = u.id
    WHERE hm.household_id = ?
  `, householdId);
  const itemsRaw = await safeQueryAll(db, 'SELECT * FROM items WHERE household_id = ? ORDER BY name', householdId);
  const items = itemsRaw.map(parseItemRow);
  const batches = await safeQueryAll(db, 'SELECT b.* FROM batches b JOIN items i ON b.item_id = i.id WHERE i.household_id = ?', householdId);
  const priceHistory = await safeQueryAll(db, 'SELECT p.* FROM item_price_history p JOIN items i ON p.item_id = i.id WHERE i.household_id = ?', householdId);
  const tasksRaw = await safeQueryAll(db, 'SELECT * FROM tasks WHERE household_id = ? ORDER BY created_at DESC', householdId);
  const tasks = tasksRaw.map(parseTaskRow);
  const taskCompletions = await safeQueryAll(db, 'SELECT * FROM task_completions WHERE household_id = ? ORDER BY completed_at DESC', householdId);
  const expenses = await safeQueryAll(db, 'SELECT * FROM expenses WHERE household_id = ? ORDER BY created_at DESC', householdId);
  const expenseSplits = await safeQueryAll(db, 'SELECT s.* FROM expense_splits s JOIN expenses e ON s.expense_id = e.id WHERE e.household_id = ?', householdId);
  const shoppingItems = await safeQueryAll(db, 'SELECT * FROM shopping_items WHERE household_id = ? ORDER BY created_at DESC', householdId);
  const locations = await safeQueryAll(db, 'SELECT * FROM locations WHERE household_id = ?', householdId);
  const categoryBudgets = await safeQueryAll(db, 'SELECT * FROM category_budgets WHERE household_id = ?', householdId);

  return Response.json({
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
  });
};
