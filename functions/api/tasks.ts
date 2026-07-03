import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';
import { requireMember } from '../../lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  const householdId = new URL(request.url).searchParams.get('householdId');
  if (!userId || !householdId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  await requireMember(env.DB, userId, householdId);
  const tasks = await env.DB.prepare('SELECT * FROM tasks WHERE household_id = ? ORDER BY created_at DESC')
    .bind(householdId).all();
  return Response.json({ tasks: tasks.results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json<any>();
  if (!body.household_id) return new Response(JSON.stringify({ error: 'household_id required' }), { status: 400 });
  await requireMember(env.DB, userId, body.household_id);

  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO tasks (id, household_id, title, description, assigned_to, status, due_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, body.household_id, body.title || '', body.description || null, body.assigned_to || null, body.status || 'todo', body.due_date || null, userId).run();

  const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  return Response.json({ task }, { status: 201 });
};
