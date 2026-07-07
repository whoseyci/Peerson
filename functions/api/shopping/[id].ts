import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../_middleware';
import { requireMember } from '../../auth';


export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const id = String(params.id);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json<any>();

  const existing = await env.DB.prepare('SELECT * FROM shopping_items WHERE id = ?').bind(id).first();
  if (!existing) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await requireMember(env.DB, userId, existing.household_id as string);

  const fields: string[] = [];
  const values: any[] = [];
  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
  if (body.quantity !== undefined) { fields.push('quantity = ?'); values.push(body.quantity); }
  if (body.status !== undefined) { fields.push('status = ?'); values.push(body.status); }
  if (body.price !== undefined) { fields.push('price = ?'); values.push(body.price !== null ? parseFloat(body.price) || null : null); }
  if (fields.length === 0) return Response.json({ item: existing });

  values.push(id);
  try {
    await env.DB.prepare(`UPDATE shopping_items SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  } catch (e: any) {
    if (e?.message?.includes('no such column: price')) {
      const fallbackFields = fields.filter(f => !f.startsWith('price'));
      if (fallbackFields.length > 0) {
        const fallbackValues = values.filter((_, idx) => !fields[idx].startsWith('price'));
        await env.DB.prepare(`UPDATE shopping_items SET ${fallbackFields.join(', ')} WHERE id = ?`).bind(...fallbackValues).run();
      }
    } else {
      throw e;
    }
  }
  const item = await env.DB.prepare('SELECT * FROM shopping_items WHERE id = ?').bind(id).first();
  return Response.json({ item });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const id = String(params.id);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const existing = await env.DB.prepare('SELECT * FROM shopping_items WHERE id = ?').bind(id).first();
  if (!existing) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await requireMember(env.DB, userId, existing.household_id as string);
  await env.DB.prepare('DELETE FROM shopping_items WHERE id = ?').bind(id).run();
  return Response.json({ success: true });
};
