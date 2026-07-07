import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env as BaseEnv } from '../_middleware';
import { notifyUsers, type Env as PushCapableEnv } from './_pushNotify';

// Adds VAPID_* env vars on top of the base Env so `notifyUsers` can read them.
// Every other handler that only reads DB keeps using the plain `Env`.
export interface Env extends BaseEnv, Pick<PushCapableEnv, 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'> {}

async function requireMember(db: D1Database, userId: string, householdId: string) {
  const row = await db.prepare('SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId).first();
  if (!row) throw new Error('Forbidden');
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  const householdId = new URL(request.url).searchParams.get('householdId');
  if (!userId || !householdId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  await requireMember(env.DB, userId, householdId);

  const expenses = await env.DB.prepare('SELECT * FROM expenses WHERE household_id = ? ORDER BY created_at DESC')
    .bind(householdId).all();
  const splits = await env.DB.prepare(`
    SELECT es.* FROM expense_splits es
    JOIN expenses e ON es.expense_id = e.id
    WHERE e.household_id = ?
  `).bind(householdId).all();
  const members = await env.DB.prepare(`
    SELECT u.id, u.name, hm.role, hm.joined_at FROM household_members hm
    JOIN users u ON hm.user_id = u.id
    WHERE hm.household_id = ?
  `).bind(householdId).all();

  const balances: Record<string, number> = {};
  members.results.forEach((m: any) => balances[m.id] = 0);
  (expenses.results as any[]).forEach((e: any) => {
    balances[e.paid_by] = (balances[e.paid_by] || 0) + e.amount;
  });
  (splits.results as any[]).forEach((s: any) => {
    balances[s.user_id] = (balances[s.user_id] || 0) - s.amount;
  });

  return Response.json({ expenses: expenses.results, splits: splits.results, members: members.results, balances });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json<any>();
  if (!body.household_id) return new Response(JSON.stringify({ error: 'household_id required' }), { status: 400 });
  await requireMember(env.DB, userId, body.household_id);

  if (body.action === 'mark_settled') {
    try {
      await env.DB.prepare(`
        UPDATE expense_splits
        SET settled = 1
        WHERE expense_id IN (
          SELECT id FROM expenses
          WHERE household_id = ? AND COALESCE(category, '') != 'settlement'
        )
      `).bind(body.household_id).run();
    } catch (e: any) {
      if (e?.message?.includes('no such column')) {
        await env.DB.prepare(`
          UPDATE expense_splits
          SET settled = 1
          WHERE expense_id IN (SELECT id FROM expenses WHERE household_id = ?)
        `).bind(body.household_id).run();
      } else { throw e; }
    }
    return Response.json({ success: true });
  }

  const id = crypto.randomUUID();
  const category = body.category || 'sonstiges';
  try {
    await env.DB.prepare(`
      INSERT INTO expenses (id, household_id, title, amount, paid_by, split_type, category)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, body.household_id, body.title || '', body.amount || 0, body.paid_by || userId, body.split_type || 'equal', category).run();
  } catch (e: any) {
    if (e?.message?.includes('no such column')) {
      await env.DB.prepare(`
        INSERT INTO expenses (id, household_id, title, amount, paid_by, split_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(id, body.household_id, body.title || '', body.amount || 0, body.paid_by || userId, body.split_type || 'equal').run();
    } else { throw e; }
  }

  if (body.splits && Array.isArray(body.splits)) {
    for (const s of body.splits) {
      await env.DB.prepare(`
        INSERT INTO expense_splits (id, expense_id, user_id, amount)
        VALUES (?, ?, ?, ?)
      `).bind(crypto.randomUUID(), id, s.user_id, s.amount).run();
    }
  }

  // Re-select the freshly inserted row rather than echoing back the
  // request body -- the body never carries server-assigned defaults like
  // created_at (DEFAULT (unixepoch())), so the previous
  // `{ id, ...body, category }` response silently omitted it entirely.
  // src/views/expenses.ts renders each expense's date via
  // `new Date(e.created_at).toLocaleDateString('de-DE')`, so a missing
  // created_at rendered as "Invalid Date" right after creating an expense,
  // until the next background sync poll re-fetched the real row.
  const created = await env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first<any>();

  // Fire Web Push notifications (Issue #48). Every household member with
  // a non-zero split OTHER than the payer gets pinged that a new expense
  // was logged that they now owe money on. Failures here are swallowed —
  // creating the expense must always succeed even if the push service is
  // slow or a subscription is expired.
  //
  // Category "settlement" (created when someone marks debts as settled)
  // is intentionally skipped: it isn't a real new expense worth waking
  // people up for, it's book-keeping.
  try {
    const isSettlement = (created?.category || category) === 'settlement';
    if (!isSettlement && Array.isArray(body.splits) && body.splits.length) {
      const payerId = body.paid_by || userId;
      const recipientUserIds = body.splits
        .filter((s: any) => s && s.user_id && s.user_id !== payerId && Number(s.amount) > 0)
        .map((s: any) => s.user_id as string);
      if (recipientUserIds.length) {
        const payerName = await env.DB.prepare('SELECT name FROM users WHERE id = ?')
          .bind(payerId).first<{ name: string }>();
        const who = payerName?.name || 'Jemand';
        const title = (body.title || 'Neue Ausgabe').toString();
        const amount = Number(body.amount || 0);
        // Payload strings stay in German to match the app's default UI language.
        await notifyUsers(env, {
          householdId: body.household_id,
          recipientUserIds,
          actorUserId: userId,
          payload: {
            title: `${who} hat eine Ausgabe eingetragen`,
            body: `${title} — ${amount.toFixed(2)} €`,
            url: '/',
            tag: `expense:${id}`,
          },
          dedupeKey: `expense:${id}`,
        });
      }
    }
  } catch (e) {
    console.error('Push notify (new expense) failed', e);
  }

  return Response.json({ expense: created }, { status: 201 });
};
