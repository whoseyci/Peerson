import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';
import { requireMember } from '../auth';


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

  // Account deletion anonymizes the user row and removes membership rows, but
  // deliberately keeps shared ledger rows intact. Include anonymized former
  // ledger participants here so balance calculations still net to zero and the
  // UI can display "Gelöschter Nutzer" instead of dropping a payer/split user.
  const memberRows = [...(members.results as any[])];
  const knownMemberIds = new Set(memberRows.map((m: any) => m.id));
  const ledgerUserIds = new Set<string>();
  (expenses.results as any[]).forEach((e: any) => { if (e.paid_by) ledgerUserIds.add(e.paid_by); });
  (splits.results as any[]).forEach((s: any) => { if (s.user_id) ledgerUserIds.add(s.user_id); });
  for (const ledgerUserId of ledgerUserIds) {
    if (knownMemberIds.has(ledgerUserId)) continue;
    const user = await env.DB.prepare('SELECT id, name FROM users WHERE id = ?').bind(ledgerUserId).first();
    memberRows.push({ id: ledgerUserId, name: (user as any)?.name || 'Unbekannt', role: 'former', joined_at: 0 });
    knownMemberIds.add(ledgerUserId);
  }

  const balances: Record<string, number> = {};
  memberRows.forEach((m: any) => balances[m.id] = 0);
  (expenses.results as any[]).forEach((e: any) => {
    balances[e.paid_by] = (balances[e.paid_by] || 0) + e.amount;
  });
  (splits.results as any[]).forEach((s: any) => {
    balances[s.user_id] = (balances[s.user_id] || 0) - s.amount;
  });

  return Response.json({ expenses: expenses.results, splits: splits.results, members: memberRows, balances });
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
  const created = await env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
  return Response.json({ expense: created }, { status: 201 });
};
