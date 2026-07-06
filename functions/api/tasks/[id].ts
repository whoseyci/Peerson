import { notifyHouseholdSync } from '../../durable/notifyHub';
import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../_middleware';

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

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const id = String(params.id);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json<any>();

  const existing = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  if (!existing) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await requireMember(env.DB, userId, existing.household_id as string);

  const fields: string[] = [];
  const values: any[] = [];
  if (body.title !== undefined) { fields.push('title = ?'); values.push(body.title); }
  if (body.description !== undefined) { fields.push('description = ?'); values.push(body.description); }
  if (body.assigned_to !== undefined) { fields.push('assigned_to = ?'); values.push(body.assigned_to); }
  if (body.status !== undefined) { fields.push('status = ?'); values.push(body.status); }
  if (body.due_date !== undefined) { fields.push('due_date = ?'); values.push(body.due_date); }
  if (body.recurrence !== undefined) { fields.push('recurrence = ?'); values.push(body.recurrence || null); }
  if (body.rotation_users !== undefined) { fields.push('rotation_users = ?'); values.push(body.rotation_users ? JSON.stringify(body.rotation_users) : null); }

  if (fields.length > 0) {
    values.push(id);
    try {
      await env.DB.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    } catch (e: any) {
      if (e?.message?.includes('no such column')) {
        const fallbackFields = fields.filter(f => !f.startsWith('recurrence') && !f.startsWith('rotation_users'));
        if (fallbackFields.length > 0) {
          const fallbackValues = values.filter((_, idx) => !fields[idx].startsWith('recurrence') && !fields[idx].startsWith('rotation_users'));
          await env.DB.prepare(`UPDATE tasks SET ${fallbackFields.join(', ')} WHERE id = ?`).bind(...fallbackValues).run();
        }
      } else { throw e; }
    }
  }

  // `completed_by` is an explicit, separate signal from `status` -- a
  // plain status:'done' update logs a completion for whoever's making the
  // request, but a *recurring* task's cycle-close never actually sets
  // status to 'done' (it stays 'todo' and just rotates assignee/due_date,
  // see src/views/tasks.ts's toggleTask()), so there's no way to infer
  // "this PATCH represents a completion" purely from the field diff. The
  // client sends this flag explicitly in both cases instead of the server
  // guessing from status transitions.
  if (body.completed_by) {
    try {
      await env.DB.prepare(
        'INSERT INTO task_completions (id, task_id, household_id, completed_by) VALUES (?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), id, existing.household_id, body.completed_by).run();
    } catch (e: any) {
      if (!e?.message?.includes('no such table')) throw e;
    }
  }

  const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  return Response.json({ task: task ? parseTaskRow(task as any) : task });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const id = String(params.id);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const existing = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  if (!existing) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await requireMember(env.DB, userId, existing.household_id as string);
  await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
  await notifyHouseholdSync(env, existing.household_id as string, { type: 'task.deleted', householdId: existing.household_id as string, payload: { id } });
  return Response.json({ success: true });
};
