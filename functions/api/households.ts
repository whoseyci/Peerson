import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';
import { requireMember } from '../auth';
import { jsonError } from '../http';

function generateId() { return crypto.randomUUID(); }
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const userId = request.headers.get('X-User-Id');
  const householdId = url.searchParams.get('householdId');
  if (!userId) return jsonError(401, 'Unauthorized');

  const db = env.DB;

  if (householdId) {
    await requireMember(db, userId, householdId);
    const household = await db.prepare('SELECT * FROM households WHERE id = ?').bind(householdId).first();
    const members = await db.prepare(`
      SELECT u.id, u.name, hm.role, hm.joined_at
      FROM household_members hm
      JOIN users u ON hm.user_id = u.id
      WHERE hm.household_id = ?
    `).bind(householdId).all();
    return Response.json({ household, members: members.results });
  }

  const list = await db.prepare(`
    SELECT h.* FROM households h
    JOIN household_members hm ON h.id = hm.household_id
    WHERE hm.user_id = ?
    ORDER BY h.created_at DESC
  `).bind(userId).all();
  return Response.json({ households: list.results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = request.headers.get('X-User-Id');
  const userName = request.headers.get('X-User-Name') || 'Anonymous';
  if (!userId) return jsonError(401, 'Unauthorized');

  const body = await request.json<{ name?: string; action?: string; code?: string; household_id?: string; target_user_id?: string }>();
  const db = env.DB;

  await db.prepare('INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)').bind(userId, userName).run();

  if (body.action === 'join' && body.code) {
    const household = await db.prepare('SELECT * FROM households WHERE invite_code = ?').bind(body.code.toUpperCase()).first();
    if (!household) return jsonError(404, 'Invalid invite code');
    await db.prepare('INSERT OR IGNORE INTO household_members (household_id, user_id, role) VALUES (?, ?, ?)')
      .bind(household.id, userId, 'member').run();
    return Response.json({ household });
  }

  if (body.action === 'leave' && body.household_id && body.target_user_id) {
    await requireMember(db, userId, body.household_id);
    await db.prepare('DELETE FROM household_members WHERE household_id = ? AND user_id = ?')
      .bind(body.household_id, body.target_user_id).run();
    return Response.json({ success: true });
  }

  if (body.action === 'kick' && body.household_id && body.target_user_id) {
    const membership = await db.prepare('SELECT role FROM household_members WHERE household_id = ? AND user_id = ?')
      .bind(body.household_id, userId).first();
    if (!membership || membership.role !== 'admin') {
      return jsonError(403, 'Forbidden');
    }
    await db.prepare('DELETE FROM household_members WHERE household_id = ? AND user_id = ?')
      .bind(body.household_id, body.target_user_id).run();
    return Response.json({ success: true });
  }

  const name = body.name?.trim();
  if (!name) return jsonError(400, 'Name required');

  const id = generateId();
  const code = generateCode();
  await db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').bind(id, name, code).run();
  await db.prepare('INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, ?)')
    .bind(id, userId, 'admin').run();

  return Response.json({ household: { id, name, invite_code: code } }, { status: 201 });
};
