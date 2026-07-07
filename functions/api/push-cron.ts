import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../_middleware';
import { sendPushToUser } from '../_push';

async function runPushSweep(env: Env, request: Request): Promise<Response> {
  if (env.CRON_SECRET) {
    const authHeader = request.headers.get('Authorization') || '';
    const cronSecretHeader = request.headers.get('X-Cron-Secret') || '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : cronSecretHeader;
    if (provided !== env.CRON_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized cron secret' }), { status: 401 });
    }
  }

  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return Response.json({ success: false, reason: 'VAPID keys not configured' });
  }

  const now = Math.floor(Date.now() / 1000);
  const todayStr = new Date().toISOString().slice(0, 10);
  const twoDaysStr = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

  let households: any[] = [];
  try {
    const res = await env.DB.prepare('SELECT id, name FROM households').all();
    households = res.results || [];
  } catch (e) {
    return Response.json({ success: false, error: 'Failed to query households' }, { status: 500 });
  }

  let tasksNotified = 0;
  let batchesNotified = 0;

  for (const h of households) {
    const householdId = h.id;

    // 1. Check due/overdue tasks
    try {
      const tasksRes = await env.DB.prepare(`
        SELECT id, title, assigned_to, due_date, status
        FROM tasks
        WHERE household_id = ? AND status != 'done' AND due_date IS NOT NULL AND due_date <= ?
      `).bind(householdId, todayStr).all();
      const tasks = (tasksRes.results || []) as any[];

      for (const task of tasks) {
        if (!task.assigned_to) continue;
        const dedupeKey = `task-due:${task.id}:${todayStr}`;

        let exists = false;
        try {
          const row = await env.DB.prepare('SELECT 1 FROM notification_log WHERE household_id = ? AND dedupe_key = ?')
            .bind(householdId, dedupeKey).first();
          if (row) exists = true;
        } catch (e: any) {
          if (!e?.message?.includes('no such table')) throw e;
        }

        if (!exists) {
          await sendPushToUser(env, task.assigned_to, householdId, {
            title: `Aufgabe fällig: ${task.title}`,
            body: `Die Aufgabe "${task.title}" ist heute fällig oder überfällig.`,
            view: 'tasks',
            tag: `task-${task.id}`,
          });
          tasksNotified++;

          try {
            await env.DB.prepare('INSERT INTO notification_log (id, household_id, dedupe_key, sent_at) VALUES (?, ?, ?, ?)')
              .bind(crypto.randomUUID(), householdId, dedupeKey, now).run();
          } catch (e: any) {
            if (!e?.message?.includes('no such table')) throw e;
          }
        }
      }
    } catch (e: any) {
      if (!e?.message?.includes('no such table')) console.error('Tasks cron error:', e);
    }

    // 2. Check expiring batches
    try {
      const batchesRes = await env.DB.prepare(`
        SELECT b.id, b.expiry, b.quantity, i.name, i.household_id
        FROM batches b
        JOIN items i ON b.item_id = i.id
        WHERE i.household_id = ? AND b.quantity > 0 AND b.expiry IS NOT NULL AND b.expiry <= ?
      `).bind(householdId, twoDaysStr).all();
      const batches = (batchesRes.results || []) as any[];

      for (const batch of batches) {
        const dedupeKey = `expiring:${batch.id}:${batch.expiry}`;

        let exists = false;
        try {
          const row = await env.DB.prepare('SELECT 1 FROM notification_log WHERE household_id = ? AND dedupe_key = ?')
            .bind(householdId, dedupeKey).first();
          if (row) exists = true;
        } catch (e: any) {
          if (!e?.message?.includes('no such table')) throw e;
        }

        if (!exists) {
          try {
            const subsRes = await env.DB.prepare('SELECT DISTINCT user_id FROM push_subscriptions WHERE household_id = ?')
              .bind(householdId).all();
            const userIds = (subsRes.results || []).map((r: any) => r.user_id);

            for (const uid of userIds) {
              await sendPushToUser(env, uid, householdId, {
                title: `Laufzeit-Warnung: ${batch.name}`,
                body: `Ein Vorrat läuft am ${batch.expiry} ab.`,
                view: 'inventory',
                tag: `batch-${batch.id}`,
              });
            }
            batchesNotified++;
          } catch (e: any) {
            if (!e?.message?.includes('no such table')) throw e;
          }

          try {
            await env.DB.prepare('INSERT INTO notification_log (id, household_id, dedupe_key, sent_at) VALUES (?, ?, ?, ?)')
              .bind(crypto.randomUUID(), householdId, dedupeKey, now).run();
          } catch (e: any) {
            if (!e?.message?.includes('no such table')) throw e;
          }
        }
      }
    } catch (e: any) {
      if (!e?.message?.includes('no such table')) console.error('Batches cron error:', e);
    }
  }

  return Response.json({ success: true, checked_households: households.length, tasksNotified, batchesNotified });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  return runPushSweep(env, request);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  return runPushSweep(env, request);
};
