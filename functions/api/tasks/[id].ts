import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../_middleware';
import { requireMember } from '../../auth';


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
        // BUGFIX (pre-existing, not introduced by this PR): the previous
        // version filtered `values` (which has one MORE element than
        // `fields` -- the appended `id` -- see `values.push(id)` above)
        // by indexing into `fields` at the same index. For that trailing
        // `id` element, `fields[idx]` is `undefined`, so calling
        // `.startsWith(...)` on it threw a TypeError, meaning this
        // graceful-degradation fallback path itself crashed instead of
        // degrading gracefully on a database missing the newer columns.
        // Fixed by zipping fields+values together BEFORE appending id,
        // filtering that paired list, then appending id once at the end.
        const newColumnPrefixes = ['recurrence', 'rotation_users', 'subtasks'];
        const paired = fields.map((f, idx) => ({ field: f, value: values[idx] }));
        const fallbackPairs = paired.filter(p => !newColumnPrefixes.some(prefix => p.field.startsWith(prefix)));
        if (fallbackPairs.length > 0) {
          const fallbackFields = fallbackPairs.map(p => p.field);
          const fallbackValues = fallbackPairs.map(p => p.value);
          fallbackValues.push(id);
          await env.DB.prepare(`UPDATE tasks SET ${fallbackFields.join(', ')} WHERE id = ?`).bind(...fallbackValues).run();
        }
      } else { throw e; }
    }
  }

  // `completed_by` is an explicit, separate signal from `status` -- a
  // plain status:'done' update logs a completion for whoever's making the
  // request, but a *recurring* task's cycle-close (with or without a
  // subtask checklist) never actually sets status to 'done' -- it stays
  // 'todo' and just rotates assigned_to/due_date (and, if it has a
  // checklist, resets every subtask to unchecked), see
  // src/views/tasks.ts's toggleTask()/toggleSubtaskInstant(). So there's
  // no way to infer "this PATCH represents a completion" purely from a
  // status transition. The client sends this flag explicitly in every
  // completion case (plain done, recurring cycle-close, and checklist
  // cycle-close alike) instead of the server guessing from `status`.
  //
  // BUGFIX: this used to be gated on `body.status === 'done' &&
  // body.completed_by`, which silently broke completion logging for
  // every recurring task (whether or not it has a checklist) -- a
  // regression against already-shipped behavior, since toggleTask()'s
  // recurring-cycle path has always sent completed_by while
  // deliberately keeping status:'todo'. Reproduced directly: PATCHing
  // { status: 'todo', assigned_to, due_date, completed_by } (the exact
  // payload toggleTask() sends for a plain, non-checklist recurring
  // task) wrote zero rows to task_completions with the buggy condition,
  // vs. the expected one row.
  if (body.completed_by) {
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
