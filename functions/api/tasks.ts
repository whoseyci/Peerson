import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';

async function requireMember(db: D1Database, userId: string, householdId: string) {
  const row = await db.prepare('SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId).first();
  if (!row) throw new Error('Forbidden');
}

function parseTaskRow<T extends { rotation_users?: unknown }>(row: T): T {
  return {
    ...row,
    rotation_users: typeof row.rotation_users === 'string' ? safeJsonParse(row.rotation_users, null) : (row.rotation_users ?? null),
  };
}

function safeJsonParse(value: string, fallback: unknown) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  const householdId = new URL(request.url).searchParams.get('householdId');
  if (!userId || !householdId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  await requireMember(env.DB, userId, householdId);
  const tasks = await env.DB.prepare('SELECT * FROM tasks WHERE household_id = ? ORDER BY created_at DESC')
    .bind(householdId).all();
  // Bundled into the same response as the tasks themselves (rather than a
  // separate endpoint) following the existing pattern in
  // functions/api/expenses.ts, which already returns `splits`+`members`
  // alongside `expenses` -- the People view always needs both the current
  // task list and the completion history together, so one round trip.
  let completions: unknown[] = [];
  try {
    const rows = await env.DB.prepare('SELECT * FROM task_completions WHERE household_id = ? ORDER BY completed_at DESC')
      .bind(householdId).all();
    completions = rows.results;
  } catch (e: any) {
    // task_completions doesn't exist yet on a database that hasn't had
    // this migration applied -- degrade to an empty list rather than
    // failing the whole tasks fetch, matching the "no such column"
    // fallback pattern used throughout this file for other columns.
    if (!e?.message?.includes('no such table')) throw e;
  }
  return Response.json({ tasks: tasks.results.map(parseTaskRow), completions });
};


export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json<any>();
  if (!body.household_id) return new Response(JSON.stringify({ error: 'household_id required' }), { status: 400 });
  await requireMember(env.DB, userId, body.household_id);

  const id = crypto.randomUUID();
  const recurrence = body.recurrence || null;
  const rotation_users = body.rotation_users ? JSON.stringify(body.rotation_users) : null;
  try {
    await env.DB.prepare(`
      INSERT INTO tasks (id, household_id, title, description, assigned_to, status, due_date, created_by, recurrence, rotation_users)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, body.household_id, body.title || '', body.description || null, body.assigned_to || null, body.status || 'todo', body.due_date || null, userId, recurrence, rotation_users).run();
  } catch (e: any) {
    if (e?.message?.includes('no such column')) {
      await env.DB.prepare(`
        INSERT INTO tasks (id, household_id, title, description, assigned_to, status, due_date, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, body.household_id, body.title || '', body.description || null, body.assigned_to || null, body.status || 'todo', body.due_date || null, userId).run();
    } else { throw e; }
  }

  const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  return Response.json({ task: task ? parseTaskRow(task as any) : task }, { status: 201 });
};
