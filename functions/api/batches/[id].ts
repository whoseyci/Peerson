import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../_middleware';
import { requireMember } from '../../auth';


export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const id = String(params.id);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json<any>();

  const batch = await env.DB.prepare('SELECT b.*, i.household_id FROM batches b JOIN items i ON b.item_id = i.id WHERE b.id = ?').bind(id).first<any>();
  if (!batch) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await requireMember(env.DB, userId, batch.household_id as string);

  if (body.quantity !== undefined) {
    const nextQuantity = Math.max(0, Number(body.quantity) || 0);
    const consumedAt = nextQuantity === 0 && Number(batch.quantity) > 0 ? Math.floor(Date.now() / 1000) : null;
    const initialQuantity = Math.max(Number(batch.initial_quantity || 0), nextQuantity, Number(batch.quantity || 0));
    try {
      await env.DB.prepare('UPDATE batches SET quantity = ?, consumed_at = ?, initial_quantity = ? WHERE id = ?')
        .bind(nextQuantity, consumedAt, initialQuantity || null, id).run();
    } catch (e: any) {
      if (!e?.message?.includes('no such column: consumed_at') && !e?.message?.includes('no such column: initial_quantity')) throw e;
      await env.DB.prepare('UPDATE batches SET quantity = ? WHERE id = ?').bind(nextQuantity, id).run();
    }
  }
  if (body.expiry !== undefined) {
    await env.DB.prepare('UPDATE batches SET expiry = ? WHERE id = ?').bind(body.expiry, id).run();
  }
  if (body.price !== undefined) {
    const price = body.price !== null ? parseFloat(body.price) || null : null;
    try {
      await env.DB.prepare('UPDATE batches SET price = ? WHERE id = ?').bind(price, id).run();
    } catch (e: any) {
      if (!e?.message?.includes('no such column: price')) throw e;
    }
  }
  if (body.location_id !== undefined) {
    try {
      await env.DB.prepare('UPDATE batches SET location_id = ? WHERE id = ?').bind(body.location_id || null, id).run();
    } catch (e: any) {
      if (!e?.message?.includes('no such column: location_id')) throw e;
    }
  }
  const updated = await env.DB.prepare('SELECT * FROM batches WHERE id = ?').bind(id).first();
  return Response.json({ batch: updated });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const id = String(params.id);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const batch = await env.DB.prepare('SELECT b.*, i.household_id FROM batches b JOIN items i ON b.item_id = i.id WHERE b.id = ?').bind(id).first<any>();
  if (!batch) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await requireMember(env.DB, userId, batch.household_id as string);

  // Retain the row at quantity=0 so consumption prediction has a completed
  // restocked-to-empty cycle (date_added -> consumed_at). This replaces the
  // previous hard delete while keeping stock totals unchanged because zeroed
  // rows contribute nothing to quantity sums.
  try {
    const initialQuantity = Math.max(Number(batch.initial_quantity || 0), Number(batch.quantity || 0));
    await env.DB.prepare('UPDATE batches SET quantity = ?, consumed_at = ?, initial_quantity = ? WHERE id = ?')
      .bind(0, Math.floor(Date.now() / 1000), initialQuantity || null, id).run();
  } catch (e: any) {
    if (!e?.message?.includes('no such column: consumed_at') && !e?.message?.includes('no such column: initial_quantity')) throw e;
    await env.DB.prepare('DELETE FROM batches WHERE id = ?').bind(id).run();
  }

  const updated = await env.DB.prepare('SELECT * FROM batches WHERE id = ?').bind(id).first();
  return Response.json({ success: true, batch: updated });
};
