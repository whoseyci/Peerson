import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../_middleware';
import { requireMember } from '../../auth';
import { jsonError } from '../../http';
import { notifyHouseholdChanged } from '../../realtime-notify';


export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const id = String(params.id);
  if (!userId) return jsonError(401, 'Unauthorized');
  const body = await request.json<any>();

  const existing = await env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
  if (!existing) return jsonError(404, 'Not found');
  await requireMember(env.DB, userId, existing.household_id as string);

  const fields: string[] = [];
  const values: any[] = [];
  if (body.title !== undefined) { fields.push('title = ?'); values.push(body.title); }
  if (body.amount !== undefined) { fields.push('amount = ?'); values.push(body.amount); }
  if (body.paid_by !== undefined) { fields.push('paid_by = ?'); values.push(body.paid_by); }
  if (body.split_type !== undefined) { fields.push('split_type = ?'); values.push(body.split_type); }
  if (body.category !== undefined) { fields.push('category = ?'); values.push(body.category || 'sonstiges'); }

  if (fields.length > 0) {
    values.push(id);
    try {
      await env.DB.prepare(`UPDATE expenses SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    } catch (e: any) {
      if (e?.message?.includes('no such column')) {
        const fallbackFields = fields.filter(f => !f.startsWith('category'));
        if (fallbackFields.length > 0) {
          const fallbackValues = values.filter((_, idx) => !fields[idx].startsWith('category'));
          await env.DB.prepare(`UPDATE expenses SET ${fallbackFields.join(', ')} WHERE id = ?`).bind(...fallbackValues).run();
        }
      } else { throw e; }
    }
  }

  if (body.splits && Array.isArray(body.splits)) {
    await env.DB.prepare('DELETE FROM expense_splits WHERE expense_id = ?').bind(id).run();
    for (const s of body.splits) {
      await env.DB.prepare(`
        INSERT INTO expense_splits (id, expense_id, user_id, amount)
        VALUES (?, ?, ?, ?)
      `).bind(crypto.randomUUID(), id, s.user_id, s.amount).run();
    }
  }

  const updated = await env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
  await notifyHouseholdChanged(env, { householdId: existing.household_id as string, resource: 'expenses', action: 'update', actorUserId: userId, excludeClientId: request.headers.get('X-Client-Id') });
  return Response.json({ expense: updated });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const id = String(params.id);
  if (!userId) return jsonError(401, 'Unauthorized');
  const existing = await env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
  if (!existing) return jsonError(404, 'Not found');
  await requireMember(env.DB, userId, existing.household_id as string);
  await env.DB.prepare('DELETE FROM expense_splits WHERE expense_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(id).run();
  await notifyHouseholdChanged(env, { householdId: existing.household_id as string, resource: 'expenses', action: 'delete', actorUserId: userId, excludeClientId: request.headers.get('X-Client-Id') });
  return Response.json({ success: true });
};
