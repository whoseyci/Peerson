import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../_middleware';

async function requireMember(db: D1Database, userId: string, householdId: string) {
  const row = await db.prepare('SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId).first();
  if (!row) throw new Error('Forbidden');
}

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
  if (body.subtasks !== undefined) { fields.push('subtasks = ?'); values.push(body.subtasks ? JSON.stringify(body.subtasks) : null); }

  if (fields.length > 0) {
    values.push(id);
    try {
      await env.DB.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    } catch (e: any) {
      if (e?.message?.includes('no such column')) {
        const fallbackFields = fields.filter(f => !f.startsWith('recurrence') && !f.startsWith('rotation_users') && !f.startsWith('subtasks'));
        if (fallbackFields.length > 0) {
          const fallbackValues = values.filter((_, idx) => !fields[idx].startsWith('recurrence') && !fields[idx].startsWith('rotation_users') && !fields[idx].startsWith('subtasks'));
          await env.DB.prepare(`UPDATE tasks SET ${fallbackFields.join(', ')} WHERE id = ?`).bind(...fallbackValues).run();
        }
      } else { throw e; }
    }
  }

  // If status is transitioning to 'done' and completed_by is sent, log a task completion (for fairness tracking)
  if (body.status === 'done' && body.completed_by) {
    try {
      const compId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO task_completions (id, task_id, household_id, completed_by, completed_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(compId, id, existing.household_id, body.completed_by, Math.floor(Date.now() / 1000)).run();
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
  return Response.json({ success: true });
};
