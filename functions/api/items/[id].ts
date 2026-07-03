import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../_middleware';
import { requireMember } from '../../../lib/auth';

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const id = String(params.id);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json<any>();

  const existing = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  if (!existing) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await requireMember(env.DB, userId, existing.household_id as string);

  const fields: string[] = [];
  const values: any[] = [];
  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
  if (body.category !== undefined) { fields.push('category = ?'); values.push(body.category); }
  if (body.icon !== undefined) { fields.push('icon = ?'); values.push(body.icon); }
  if (body.threshold !== undefined) { fields.push('threshold = ?'); values.push(body.threshold); }
  if (body.location !== undefined) { fields.push('location = ?'); values.push(body.location); }
  if (body.barcodes !== undefined) { fields.push('barcodes = ?'); values.push(JSON.stringify(body.barcodes)); }
  if (body.nutrition !== undefined) { fields.push('nutrition = ?'); values.push(JSON.stringify(body.nutrition)); }
  if (fields.length === 0) return Response.json({ item: existing });

  values.push(id);
  await env.DB.prepare(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  const item = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  return Response.json({ item });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const id = String(params.id);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const existing = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  if (!existing) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await requireMember(env.DB, userId, existing.household_id as string);
  await env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id).run();
  return Response.json({ success: true });
};
