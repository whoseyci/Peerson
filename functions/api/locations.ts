import { notifyHouseholdSync } from '../durable/notifyHub';
import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';

async function requireMember(db: D1Database, userId: string, householdId: string) {
  const row = await db.prepare('SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId).first();
  if (!row) throw new Error('Forbidden');
}

// GET /api/locations?householdId=... -- returns the whole location tree for
// a household as a flat list (id, parent_id, name, sort_order). The client
// assembles it into a tree; keeping it flat here means one cheap indexed
// query instead of N recursive round trips, and the client already needs a
// flat array to easily look up "what's my item's location's parent chain"
// for breadcrumbs.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  const householdId = new URL(request.url).searchParams.get('householdId');
  if (!userId || !householdId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  await requireMember(env.DB, userId, householdId);

  const locations = await env.DB.prepare('SELECT * FROM locations WHERE household_id = ?')
    .bind(householdId).all();
  // Sort client-side rather than in SQL: root nodes first, then by
  // sort_order/name within each parent -- keeps this handler portable
  // across D1 and the project's simplified test-mock DB (test/mocks/d1.ts),
  // which doesn't parse compound ORDER BY expressions.
  const sorted = (locations.results as any[]).sort((a, b) => {
    if ((a.parent_id === null) !== (b.parent_id === null)) return a.parent_id === null ? -1 : 1;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return String(a.name).localeCompare(String(b.name));
  });
  return Response.json({ locations: sorted });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json<any>();
  if (!body.household_id) return new Response(JSON.stringify({ error: 'household_id required' }), { status: 400 });
  const name = (body.name || '').trim();
  if (!name) return new Response(JSON.stringify({ error: 'name required' }), { status: 400 });
  await requireMember(env.DB, userId, body.household_id);

  const parentId = body.parent_id || null;
  if (parentId) {
    // The parent must exist in the same household -- otherwise a malicious
    // or buggy client could link a node into another household's tree.
    const parent = await env.DB.prepare('SELECT household_id FROM locations WHERE id = ?').bind(parentId).first();
    if (!parent || parent.household_id !== body.household_id) {
      return new Response(JSON.stringify({ error: 'Invalid parent_id' }), { status: 400 });
    }
  }

  // New siblings go to the end of their parent's list by default. Computed
  // via .all() + JS length rather than SQL COUNT(*)/IS-NULL-safe comparison
  // for the same test-mock-portability reason as the GET handler above.
  const siblings = await env.DB.prepare('SELECT id FROM locations WHERE household_id = ?').bind(body.household_id).all();
  const siblingCount = (siblings.results as any[]).filter(l => (l.parent_id ?? null) === parentId).length;

  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO locations (id, household_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, body.household_id, parentId, name, siblingCount).run();

  const location = await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(id).first();
  await notifyHouseholdSync(env, body.household_id, { type: 'location.created', householdId: body.household_id, payload: { id } });
  return Response.json({ location }, { status: 201 });
};

