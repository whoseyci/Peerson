import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../_middleware';

async function requireMember(db: D1Database, userId: string, householdId: string) {
  const row = await db.prepare('SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId).first();
  if (!row) throw new Error('Forbidden');
}

// Walks parent_id pointers up from `startId` to the root, returning true if
// `targetId` appears anywhere in that chain (including startId itself).
// Used to reject a reparent that would turn the tree into a cycle -- e.g.
// moving "Küche" to become a child of "Rollcontainer", which is itself
// inside "Küche". A capped walk (rather than a recursive CTE) keeps this
// simple and portable across D1's SQLite version; household location trees
// are small (dozens of nodes at most) so the cap is generous, not a real
// limit in practice.
async function wouldCreateCycle(db: D1Database, targetId: string, startId: string | null): Promise<boolean> {
  let current = startId;
  let hops = 0;
  while (current && hops < 1000) {
    if (current === targetId) return true;
    const row = await db.prepare('SELECT parent_id FROM locations WHERE id = ?').bind(current).first<{ parent_id: string | null }>();
    current = row?.parent_id ?? null;
    hops++;
  }
  return false;
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const id = String(params.id);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json<any>();

  const existing = await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(id).first();
  if (!existing) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await requireMember(env.DB, userId, existing.household_id as string);

  const fields: string[] = [];
  const values: any[] = [];

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return new Response(JSON.stringify({ error: 'name cannot be empty' }), { status: 400 });
    fields.push('name = ?');
    values.push(name);
  }

  if (body.parent_id !== undefined) {
    const newParentId = body.parent_id || null;
    if (newParentId) {
      const parent = await env.DB.prepare('SELECT household_id FROM locations WHERE id = ?').bind(newParentId).first();
      if (!parent || parent.household_id !== existing.household_id) {
        return new Response(JSON.stringify({ error: 'Invalid parent_id' }), { status: 400 });
      }
      if (await wouldCreateCycle(env.DB, id, newParentId)) {
        return new Response(JSON.stringify({ error: 'Cannot move a location into its own subtree' }), { status: 400 });
      }
    }
    fields.push('parent_id = ?');
    values.push(newParentId);
  }

  if (body.sort_order !== undefined) {
    fields.push('sort_order = ?');
    values.push(body.sort_order);
  }

  if (fields.length === 0) return Response.json({ location: existing });

  values.push(id);
  await env.DB.prepare(`UPDATE locations SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  const location = await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(id).first();
  return Response.json({ location });
};

// Deleting a location cascades to its descendants (ON DELETE CASCADE in
// schema.sql) and un-assigns any items pointing at it or its descendants
// (ON DELETE SET NULL) -- an item never gets silently deleted just because
// its shelf got removed from the tree.
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const id = String(params.id);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const existing = await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(id).first();
  if (!existing) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await requireMember(env.DB, userId, existing.household_id as string);
  await env.DB.prepare('DELETE FROM locations WHERE id = ?').bind(id).run();
  return Response.json({ success: true });
};
