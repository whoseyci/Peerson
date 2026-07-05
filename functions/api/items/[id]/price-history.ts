import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../../_middleware';

async function requireMember(db: D1Database, userId: string, householdId: string) {
  const row = await db.prepare('SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId).first();
  if (!row) throw new Error('Forbidden');
}

// GET /api/items/:id/price-history -- the closed (superseded) price entries
// for an item, oldest first, so the client can render "199€ -> 249€ -> 299€"
// style inflation timelines. The *current* price is NOT included here; it
// lives on the item itself (item.price_cents) since it's still open-ended
// (no effective_until yet).
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = request.headers.get('X-User-Id');
  const id = String(params.id);
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const item = await env.DB.prepare('SELECT household_id FROM items WHERE id = ?').bind(id).first();
  if (!item) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await requireMember(env.DB, userId, item.household_id as string);

  const history = await env.DB.prepare('SELECT * FROM item_price_history WHERE item_id = ?').bind(id).all();
  // Sorted client-side (see functions/api/locations.ts for the same
  // reasoning) so this works against both real D1 and the project's
  // simplified test-mock DB, which doesn't parse ORDER BY.
  const sorted = (history.results as any[]).sort((a, b) => a.effective_from - b.effective_from);
  return Response.json({ history: sorted });
};
