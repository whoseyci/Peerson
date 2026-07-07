import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';
import { requireMember } from '../auth';
import { jsonError } from '../http';
import { notifyHouseholdChanged } from '../realtime-notify';


function parseTaskRow<T extends { rotation_users?: unknown; subtasks?: unknown }>(row: T): T {
  return {
    ...row,
    rotation_users: typeof row.rotation_users === 'string' ? safeJsonParse(row.rotation_users, null) : (row.rotation_users ?? null),
    subtasks: typeof row.subtasks === 'string' ? safeJsonParse(row.subtasks, null) : (row.subtasks ?? null),
  };
}

function safeJsonParse(value: string, fallback: unknown) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  const householdId = new URL(request.url).searchParams.get('householdId');
  if (!userId || !householdId) return jsonError(401, 'Unauthorized');
  await requireMember(env.DB, userId, householdId);
  const tasks = await env.DB.prepare('SELECT * FROM tasks WHERE household_id = ? ORDER BY created_at DESC')
    .bind(householdId).all();
  let completions: unknown[] = [];
  try {
    const rows = await env.DB.prepare('SELECT * FROM task_completions WHERE household_id = ? ORDER BY completed_at DESC')
      .bind(householdId).all();
    completions = rows.results;
  } catch (e: any) {
    if (!e?.message?.includes('no such table')) throw e;
  }
  return Response.json({ tasks: tasks.results.map(parseTaskRow), completions });
};


export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return jsonError(401, 'Unauthorized');
  const body = await request.json<any>();
  if (!body.household_id) return jsonError(400, 'household_id required');
  await requireMember(env.DB, userId, body.household_id);

  const id = crypto.randomUUID();
  const recurrence = body.recurrence || null;
  const rotation_users = body.rotation_users ? JSON.stringify(body.rotation_users) : null;
  const subtasks = body.subtasks ? JSON.stringify(body.subtasks) : null;
  try {
    await env.DB.prepare(`
      INSERT INTO tasks (id, household_id, title, description, assigned_to, status, due_date, created_by, recurrence, rotation_users, subtasks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, body.household_id, body.title || '', body.description || null, body.assigned_to || null, body.status || 'todo', body.due_date || null, userId, recurrence, rotation_users, subtasks).run();
  } catch (e: any) {
    if (e?.message?.includes('no such column')) {
      try {
        await env.DB.prepare(`
          INSERT INTO tasks (id, household_id, title, description, assigned_to, status, due_date, created_by, recurrence, rotation_users)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(id, body.household_id, body.title || '', body.description || null, body.assigned_to || null, body.status || 'todo', body.due_date || null, userId, recurrence, rotation_users).run();
      } catch (e2: any) {
        if (e2?.message?.includes('no such column')) {
          await env.DB.prepare(`
            INSERT INTO tasks (id, household_id, title, description, assigned_to, status, due_date, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(id, body.household_id, body.title || '', body.description || null, body.assigned_to || null, body.status || 'todo', body.due_date || null, userId).run();
        } else { throw e2; }
      }
    } else { throw e; }
  }

  const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  await notifyHouseholdChanged(env, { householdId: body.household_id, resource: 'tasks', action: 'create', actorUserId: userId, excludeClientId: request.headers.get('X-Client-Id') });
  return Response.json({ task: task ? parseTaskRow(task as any) : task }, { status: 201 });
};
