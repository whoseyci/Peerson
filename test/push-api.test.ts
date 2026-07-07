import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1 } from './mocks/d1';
import type { Env } from '../functions/_middleware';

function makeRequest(url: string, opts: RequestInit = {}, userId = 'test-user', householdId = 'house-1'): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };
  if (userId) headers['X-User-Id'] = userId;
  if (householdId) headers['X-Household-Id'] = householdId;
  return new Request(url, { ...opts, headers });
}

async function runHandler(handler: any, request: Request, env: Env) {
  return handler({ request, env } as any);
}

describe('Push Notifications API & Cron Logic (Issue #48)', () => {
  let env: Env;
  let d1: ReturnType<typeof createMockD1>;
  const validPub = 'BC-te_L0_DtGBsJ8mVXfRsy-GMM0S5B-4bER4p7XiQK7RfT5vk_j0L0N9KaZpDt7sBe5wROp1zc0ufOdfLYoPw0';
  const validPriv = 'UN10AKyzdRXNoxdyOiyaQryxRsn-9IAO7pHO71upMf4';
  const clientP256dh = 'BEUkUhtGDHv8LzcHZ64y0O-tE4eUK4GEswAeTx7paUNaz1yFAO2Qh59OaK2fdLV6GT7yrU3IllR78Szso42Xo-M';
  const clientAuth = '0P2XrBnI1lhHEC7e99oc2A';

  beforeEach(() => {
    d1 = createMockD1();
    env = {
      DB: d1,
      VAPID_PUBLIC_KEY: validPub,
      VAPID_PRIVATE_KEY: validPriv,
      VAPID_SUBJECT: 'mailto:test@peerson.app',
    } as unknown as Env;
    vi.restoreAllMocks();
  });

  describe('push-subscribe & push-unsubscribe endpoints', () => {
    it('POST /api/push-subscribe returns 401 without user id', async () => {
      const { onRequestPost } = await import('../functions/api/push-subscribe');
      const req = new Request('http://test/api/push-subscribe', { method: 'POST' });
      const res = await runHandler(onRequestPost, req, env);
      expect(res.status).toBe(401);
    });

    it('POST /api/push-subscribe returns 501 when VAPID keys are not configured', async () => {
      const { onRequestPost } = await import('../functions/api/push-subscribe');
      const noKeysEnv = { DB: d1 } as unknown as Env;
      const req = makeRequest('http://test/api/push-subscribe', { method: 'POST', body: '{}' });
      const res = await runHandler(onRequestPost, req, noKeysEnv);
      expect(res.status).toBe(501);
    });

    it('POST /api/push-subscribe returns 403 for non-member', async () => {
      const { onRequestPost } = await import('../functions/api/push-subscribe');
      d1.seedMembership('house-1', 'member-user');
      const req = makeRequest('http://test/api/push-subscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: 'https://push.example/1', keys: { p256dh: clientP256dh, auth: clientAuth } }),
      }, 'stranger-user', 'house-1');
      const res = await runHandler(onRequestPost, req, env);
      expect(res.status).toBe(403);
    });

    it('POST /api/push-subscribe creates a subscription and GET returns it', async () => {
      const { onRequestPost, onRequestGet } = await import('../functions/api/push-subscribe');
      d1.seedMembership('house-1', 'test-user');

      const reqPost = makeRequest('http://test/api/push-subscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: 'https://push.example/1', keys: { p256dh: clientP256dh, auth: clientAuth } }),
      });
      const resPost = await runHandler(onRequestPost, reqPost, env);
      expect(resPost.status).toBe(200);

      const rows = (await d1.prepare('SELECT * FROM push_subscriptions').all()).results;
      expect(rows.length).toBe(1);
      expect(rows[0].endpoint).toBe('https://push.example/1');

      const reqGet = makeRequest('http://test/api/push-subscribe?householdId=house-1');
      const resGet = await runHandler(onRequestGet, reqGet, env);
      expect(resGet.status).toBe(200);
      const data = await resGet.json();
      expect(data.configured).toBe(true);
      expect(data.vapidPublicKey).toBe(validPub);
      expect(data.subscriptions).toContain('https://push.example/1');
    });

    it('POST /api/push-subscribe updates (upserts) on duplicate endpoint instead of creating duplicates', async () => {
      const { onRequestPost } = await import('../functions/api/push-subscribe');
      d1.seedMembership('house-1', 'test-user');

      const req1 = makeRequest('http://test/api/push-subscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: 'https://push.example/dupe', keys: { p256dh: clientP256dh, auth: clientAuth } }),
      });
      await runHandler(onRequestPost, req1, env);

      const req2 = makeRequest('http://test/api/push-subscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: 'https://push.example/dupe', keys: { p256dh: clientP256dh, auth: clientAuth } }),
      });
      await runHandler(onRequestPost, req2, env);

      const rows = (await d1.prepare('SELECT * FROM push_subscriptions').all()).results;
      expect(rows.length).toBe(1);
    });

    it('POST /api/push-unsubscribe removes the subscription', async () => {
      const { onRequestPost: subPost } = await import('../functions/api/push-subscribe');
      const { onRequestPost: unsubPost } = await import('../functions/api/push-unsubscribe');
      d1.seedMembership('house-1', 'test-user');

      await runHandler(subPost, makeRequest('http://test/api/push-subscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: 'https://push.example/unsub', keys: { p256dh: clientP256dh, auth: clientAuth } }),
      }), env);

      const rowsBefore = (await d1.prepare('SELECT * FROM push_subscriptions').all()).results;
      expect(rowsBefore.length).toBe(1);

      const resUnsub = await runHandler(unsubPost, makeRequest('http://test/api/push-unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: 'https://push.example/unsub' }),
      }), env);
      expect(resUnsub.status).toBe(200);

      const rowsAfter = (await d1.prepare('SELECT * FROM push_subscriptions').all()).results;
      expect(rowsAfter.length).toBe(0);
    });
  });

  describe('Deduplication logic (push-cron)', () => {
    it('calling send due-task notifications twice in a row only sends once', async () => {
      const { onRequestPost } = await import('../functions/api/push-cron');
      d1.seedMembership('house-1', 'user-task');

      await d1.prepare("INSERT INTO households (id, name) VALUES (?, ?)").bind('house-1', 'WG Test').run();
      await d1.prepare("INSERT INTO push_subscriptions (id, user_id, household_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?, ?)")
        .bind('sub-1', 'user-task', 'house-1', 'https://fcm.googleapis.com/fcm/send/test', clientP256dh, clientAuth).run();

      const todayStr = new Date().toISOString().slice(0, 10);
      await d1.prepare("INSERT INTO tasks (id, household_id, title, status, assigned_to, due_date) VALUES (?, ?, ?, ?, ?, ?)")
        .bind('task-1', 'house-1', 'Müll raus', 'todo', 'user-task', todayStr).run();

      const fetchMock = vi.fn(async () => new Response('OK', { status: 201 }));
      (globalThis as any).fetch = fetchMock;

      // First run should send notification
      const req1 = new Request('http://test/api/push-cron', { method: 'POST' });
      const res1 = await runHandler(onRequestPost, req1, env);
      const body1 = await res1.json();
      expect(body1.success).toBe(true);
      expect(body1.tasksNotified).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second run immediately after should NOT send duplicate notification!
      const req2 = new Request('http://test/api/push-cron', { method: 'POST' });
      const res2 = await runHandler(onRequestPost, req2, env);
      const body2 = await res2.json();
      expect(body2.success).toBe(true);
      expect(body2.tasksNotified).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(1); // still 1!
    });
  });

  describe('Expense-creation push trigger', () => {
    it('sends to every split participant except the payer in a multi-member household', async () => {
      const { onRequestPost } = await import('../functions/api/expenses');
      await d1.prepare("INSERT INTO households (id, name) VALUES (?, ?)").bind('house-1', 'WG Multi').run();
      await d1.prepare("INSERT INTO users (id, name) VALUES (?, ?)").bind('payer', 'Payer Person').run();
      await d1.prepare("INSERT INTO users (id, name) VALUES (?, ?)").bind('split-1', 'Split One').run();
      await d1.prepare("INSERT INTO users (id, name) VALUES (?, ?)").bind('split-2', 'Split Two').run();
      d1.seedMembership('house-1', 'payer');
      d1.seedMembership('house-1', 'split-1');
      d1.seedMembership('house-1', 'split-2');

      await d1.prepare("INSERT INTO push_subscriptions (id, user_id, household_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?, ?)")
        .bind('s0', 'payer', 'house-1', 'https://fcm.googleapis.com/payer', clientP256dh, clientAuth).run();
      await d1.prepare("INSERT INTO push_subscriptions (id, user_id, household_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?, ?)")
        .bind('s1', 'split-1', 'house-1', 'https://fcm.googleapis.com/split1', clientP256dh, clientAuth).run();
      await d1.prepare("INSERT INTO push_subscriptions (id, user_id, household_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?, ?)")
        .bind('s2', 'split-2', 'house-1', 'https://fcm.googleapis.com/split2', clientP256dh, clientAuth).run();

      const fetchMock = vi.fn(async () => new Response('OK', { status: 201 }));
      (globalThis as any).fetch = fetchMock;

      const req = makeRequest('http://test/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          household_id: 'house-1',
          title: 'Dinner Party',
          amount: 30,
          paid_by: 'payer',
          split_type: 'custom',
          splits: [
            { user_id: 'payer', amount: 10 },
            { user_id: 'split-1', amount: 10 },
            { user_id: 'split-2', amount: 10 },
          ],
        }),
      }, 'payer', 'house-1');

      const res = await runHandler(onRequestPost, req, env);
      expect(res.status).toBe(201);

      // Must be called exactly twice: once for split-1, once for split-2. NOT called for payer!
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const calledUrls = fetchMock.mock.calls.map(c => c[0]);
      expect(calledUrls).toContain('https://fcm.googleapis.com/split1');
      expect(calledUrls).toContain('https://fcm.googleapis.com/split2');
      expect(calledUrls).not.toContain('https://fcm.googleapis.com/payer');
    });

    it('NOT called if there is only one household member', async () => {
      const { onRequestPost } = await import('../functions/api/expenses');
      await d1.prepare("INSERT INTO households (id, name) VALUES (?, ?)").bind('house-solo', 'WG Solo').run();
      await d1.prepare("INSERT INTO users (id, name) VALUES (?, ?)").bind('solo', 'Solo Person').run();
      d1.seedMembership('house-solo', 'solo');

      await d1.prepare("INSERT INTO push_subscriptions (id, user_id, household_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?, ?)")
        .bind('s-solo', 'solo', 'house-solo', 'https://fcm.googleapis.com/solo', clientP256dh, clientAuth).run();

      const fetchMock = vi.fn(async () => new Response('OK', { status: 201 }));
      (globalThis as any).fetch = fetchMock;

      const req = makeRequest('http://test/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          household_id: 'house-solo',
          title: 'Solo Coffee',
          amount: 5,
          paid_by: 'solo',
          split_type: 'equal',
          splits: [{ user_id: 'solo', amount: 5 }],
        }),
      }, 'solo', 'house-solo');

      const res = await runHandler(onRequestPost, req, env);
      expect(res.status).toBe(201);

      // Must NOT be called when solo in household!
      expect(fetchMock).toHaveBeenCalledTimes(0);
    });
  });
});

describe('Expiring batches cron check', () => {
  it('sends expiry warning for batch expiring within 2 days and deduplicates', async () => {
    const { onRequestPost } = await import('../functions/api/push-cron');
    const d1 = createMockD1();
    const validPub = 'BC-te_L0_DtGBsJ8mVXfRsy-GMM0S5B-4bER4p7XiQK7RfT5vk_j0L0N9KaZpDt7sBe5wROp1zc0ufOdfLYoPw0';
    const validPriv = 'UN10AKyzdRXNoxdyOiyaQryxRsn-9IAO7pHO71upMf4';
    const clientP256dh = 'BEUkUhtGDHv8LzcHZ64y0O-tE4eUK4GEswAeTx7paUNaz1yFAO2Qh59OaK2fdLV6GT7yrU3IllR78Szso42Xo-M';
    const clientAuth = '0P2XrBnI1lhHEC7e99oc2A';
    const env = { DB: d1, VAPID_PUBLIC_KEY: validPub, VAPID_PRIVATE_KEY: validPriv, VAPID_SUBJECT: 'mailto:test@peerson.app' } as any;

    d1.seedMembership('house-1', 'user-batch');
    await d1.prepare("INSERT INTO households (id, name) VALUES (?, ?)").bind('house-1', 'WG Test').run();
    await d1.prepare("INSERT INTO push_subscriptions (id, user_id, household_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?, ?)")
      .bind('sub-1', 'user-batch', 'house-1', 'https://fcm.googleapis.com/fcm/send/batch', clientP256dh, clientAuth).run();

    const twoDaysStr = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    await d1.prepare("INSERT INTO items (id, household_id, name) VALUES (?, ?, ?)").bind('item-1', 'house-1', 'Milch').run();
    await d1.prepare("INSERT INTO batches (id, item_id, quantity, expiry) VALUES (?, ?, ?, ?)").bind('batch-1', 'item-1', 1, twoDaysStr).run();

    const fetchMock = vi.fn(async () => new Response('OK', { status: 201 }));
    (globalThis as any).fetch = fetchMock;

    const req1 = new Request('http://test/api/push-cron', { method: 'POST' });
    const res1 = await (await import('../functions/api/push-cron')).onRequestPost({ request: req1, env } as any);
    const body1 = await res1.json();
    expect(body1.success).toBe(true);
    expect(body1.batchesNotified).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second run should deduplicate!
    const req2 = new Request('http://test/api/push-cron', { method: 'POST' });
    const res2 = await (await import('../functions/api/push-cron')).onRequestPost({ request: req2, env } as any);
    const body2 = await res2.json();
    expect(body2.success).toBe(true);
    expect(body2.batchesNotified).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
