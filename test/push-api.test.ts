import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createMockD1 } from './mocks/d1';
import type { Env as PushSubEnv } from '../functions/api/push-subscribe';
import type { Env as PushUnsubEnv } from '../functions/api/push-unsubscribe';
import type { Env as PushConfigEnv } from '../functions/api/push-config';
import type { Env as ExpensesEnv } from '../functions/api/expenses';

function makeRequest(url: string, opts: RequestInit = {}, userId = 'test-user', householdId = 'house-1'): Request {
  return new Request(url, {
    ...opts,
    headers: {
      'X-User-Id': userId,
      'X-Household-Id': householdId,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  });
}

async function runHandler(handler: any, request: Request, env: any) {
  return handler({ request, env, params: {} } as any);
}

const FAKE_VAPID = {
  // Placeholder base64url values -- the endpoints only check "are these
  // env vars set?" to gate behavior, they don't validate the key material
  // itself. Actual crypto is covered by test/push-lib.test.ts using
  // freshly-generated keypairs.
  VAPID_PUBLIC_KEY: 'BFake_pub',
  VAPID_PRIVATE_KEY: 'fake_priv',
  VAPID_SUBJECT: 'mailto:test@peerson.example',
};

describe('GET /api/push-config', () => {
  it('returns { configured: false } when VAPID env vars are missing', async () => {
    const { onRequestGet } = await import('../functions/api/push-config');
    const env = { DB: createMockD1() } as unknown as PushConfigEnv;
    const res = await runHandler(onRequestGet, new Request('http://test/api/push-config'), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ configured: false, publicKey: null });
  });

  it('returns { configured: true, publicKey } when VAPID env vars are set', async () => {
    const { onRequestGet } = await import('../functions/api/push-config');
    const env = { DB: createMockD1(), ...FAKE_VAPID } as unknown as PushConfigEnv;
    const res = await runHandler(onRequestGet, new Request('http://test/api/push-config'), env);
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.publicKey).toBe(FAKE_VAPID.VAPID_PUBLIC_KEY);
  });
});

describe('POST /api/push-subscribe', () => {
  let env: PushSubEnv;
  let d1: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    d1 = createMockD1();
    d1.seedMembership('house-1', 'test-user');
    env = { DB: d1, ...FAKE_VAPID } as unknown as PushSubEnv;
  });

  it('returns 501 when VAPID is not configured (graceful, matches bug-report.ts pattern)', async () => {
    const { onRequestPost } = await import('../functions/api/push-subscribe');
    const bareEnv = { DB: d1 } as unknown as PushSubEnv;
    const res = await runHandler(
      onRequestPost,
      makeRequest('http://test/api/push-subscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: 'https://push/x', keys: { p256dh: 'k', auth: 'a' } }),
      }),
      bareEnv
    );
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toMatch(/VAPID/i);
  });

  it('returns 401 without X-User-Id or X-Household-Id', async () => {
    const { onRequestPost } = await import('../functions/api/push-subscribe');
    const req = new Request('http://test/api/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://push/x', keys: { p256dh: 'k', auth: 'a' } }),
    });
    const res = await runHandler(onRequestPost, req, env);
    expect(res.status).toBe(401);
  });

  it('returns 403 when the user is not a member of the household', async () => {
    const { onRequestPost } = await import('../functions/api/push-subscribe');
    const res = await runHandler(
      onRequestPost,
      makeRequest(
        'http://test/api/push-subscribe',
        {
          method: 'POST',
          body: JSON.stringify({ endpoint: 'https://push/x', keys: { p256dh: 'k', auth: 'a' } }),
        },
        'stranger',
        'house-1'
      ),
      env
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 when required fields are missing', async () => {
    const { onRequestPost } = await import('../functions/api/push-subscribe');
    const res = await runHandler(
      onRequestPost,
      makeRequest('http://test/api/push-subscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: 'https://push/x' }),
      }),
      env
    );
    expect(res.status).toBe(400);
  });

  it('creates a new subscription row on first subscribe', async () => {
    const { onRequestPost } = await import('../functions/api/push-subscribe');
    const res = await runHandler(
      onRequestPost,
      makeRequest('http://test/api/push-subscribe', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: 'https://push/endpoint-1',
          keys: { p256dh: 'pubkey', auth: 'authsecret' },
        }),
      }),
      env
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.updated).toBe(false);
    expect(typeof body.id).toBe('string');
  });

  it('updates instead of duplicating when the same endpoint re-subscribes', async () => {
    const { onRequestPost } = await import('../functions/api/push-subscribe');
    const req1 = makeRequest('http://test/api/push-subscribe', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: 'https://push/endpoint-1',
        keys: { p256dh: 'pubkey', auth: 'authsecret' },
      }),
    });
    await runHandler(onRequestPost, req1, env);
    const req2 = makeRequest('http://test/api/push-subscribe', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: 'https://push/endpoint-1',
        keys: { p256dh: 'newpub', auth: 'newauth' },
      }),
    });
    const res2 = await runHandler(onRequestPost, req2, env);
    expect(res2.status).toBe(200);
    const body = await res2.json();
    expect(body.updated).toBe(true);
  });
});

describe('POST /api/push-unsubscribe', () => {
  let env: PushUnsubEnv;
  let d1: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    d1 = createMockD1();
    env = { DB: d1 } as unknown as PushUnsubEnv;
  });

  it('returns 401 without X-User-Id', async () => {
    const { onRequestPost } = await import('../functions/api/push-unsubscribe');
    const req = new Request('http://test/api/push-unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://push/x' }),
    });
    const res = await runHandler(onRequestPost, req, env);
    expect(res.status).toBe(401);
  });

  it('returns 400 without endpoint', async () => {
    const { onRequestPost } = await import('../functions/api/push-unsubscribe');
    const res = await runHandler(
      onRequestPost,
      makeRequest('http://test/api/push-unsubscribe', { method: 'POST', body: JSON.stringify({}) }),
      env
    );
    expect(res.status).toBe(400);
  });

  it('succeeds even when no matching row exists (idempotent)', async () => {
    const { onRequestPost } = await import('../functions/api/push-unsubscribe');
    const res = await runHandler(
      onRequestPost,
      makeRequest('http://test/api/push-unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: 'https://push/never-registered' }),
      }),
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

describe('POST /api/expenses fires a Web Push to every other split-participant', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends notifications only to non-payer members with a non-zero split', async () => {
    const d1 = createMockD1();
    d1.seedMembership('house-1', 'payer-user');
    d1.seedMembership('house-1', 'other-user');

    // We need real P-256 subscriber keys (not just placeholder strings)
    // because sendPush actually encrypts against them via WebCrypto.
    const b64url = (bytes: Uint8Array) => {
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    async function realSubscriberKeys() {
      const kp = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
      );
      const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
      const auth = crypto.getRandomValues(new Uint8Array(16));
      return { p256dh: b64url(rawPub), auth: b64url(auth) };
    }
    const otherKeys = await realSubscriberKeys();
    const payerKeys = await realSubscriberKeys();

    d1.seed('push_subscriptions', [
      {
        id: 'sub-1',
        user_id: 'other-user',
        household_id: 'house-1',
        endpoint: 'https://push.example/other',
        p256dh: otherKeys.p256dh,
        auth: otherKeys.auth,
      },
      {
        id: 'sub-2',
        user_id: 'payer-user', // The payer's own device: MUST NOT be notified.
        household_id: 'house-1',
        endpoint: 'https://push.example/payer',
        p256dh: payerKeys.p256dh,
        auth: payerKeys.auth,
      },
    ]);
    d1.seed('users', [
      { id: 'payer-user', name: 'Alex' },
      { id: 'other-user', name: 'Sam' },
    ]);

    // Generate real VAPID keys so buildVapidHeaders can actually sign.
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign']
    );
    const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    const jwkPriv = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const env = {
      DB: d1,
      VAPID_PUBLIC_KEY: b64url(rawPub),
      VAPID_PRIVATE_KEY: jwkPriv.d!,
      VAPID_SUBJECT: 'mailto:test@peerson.example',
    } as unknown as ExpensesEnv;

    // Capture outgoing fetches instead of hitting the network.
    const pushedTo: string[] = [];
    global.fetch = (vi.fn(async (url: any) => {
      pushedTo.push(String(url));
      return new Response(null, { status: 201 });
    }) as unknown) as typeof fetch;

    const { onRequestPost } = await import('../functions/api/expenses');
    const req = makeRequest(
      'http://test/api/expenses',
      {
        method: 'POST',
        body: JSON.stringify({
          household_id: 'house-1',
          title: 'Pizza',
          amount: 20,
          paid_by: 'payer-user',
          splits: [
            { user_id: 'payer-user', amount: 10 },
            { user_id: 'other-user', amount: 10 },
          ],
        }),
      },
      'payer-user',
      'house-1'
    );
    const res = await runHandler(onRequestPost, req, env);
    expect(res.status).toBe(201);

    // Give the (already-awaited) push send a microtask to flush.
    await new Promise(r => setTimeout(r, 0));

    expect(pushedTo).toContain('https://push.example/other');
    expect(pushedTo).not.toContain('https://push.example/payer');
  });

  it('is silently skipped for the "settlement" category', async () => {
    const d1 = createMockD1();
    d1.seedMembership('house-1', 'payer-user');
    d1.seedMembership('house-1', 'other-user');
    d1.seed('push_subscriptions', [{
      id: 'sub-1', user_id: 'other-user', household_id: 'house-1',
      endpoint: 'https://push.example/other', p256dh: 'k', auth: 'a',
    }]);
    d1.seed('users', [{ id: 'payer-user', name: 'Alex' }]);

    const env = {
      DB: d1,
      // Even with VAPID configured, the settlement path must not send.
      VAPID_PUBLIC_KEY: 'BFake', VAPID_PRIVATE_KEY: 'fake', VAPID_SUBJECT: 'mailto:x@x',
    } as unknown as ExpensesEnv;

    let fetchCalls = 0;
    global.fetch = (vi.fn(async () => {
      fetchCalls++;
      return new Response(null, { status: 201 });
    }) as unknown) as typeof fetch;

    const { onRequestPost } = await import('../functions/api/expenses');
    const req = makeRequest(
      'http://test/api/expenses',
      {
        method: 'POST',
        body: JSON.stringify({
          household_id: 'house-1',
          title: 'Ausgleich',
          amount: 5,
          paid_by: 'payer-user',
          category: 'settlement',
          splits: [{ user_id: 'other-user', amount: 5 }],
        }),
      },
      'payer-user',
      'house-1'
    );
    await runHandler(onRequestPost, req, env);
    await new Promise(r => setTimeout(r, 0));
    expect(fetchCalls).toBe(0);
  });

  it('is silently skipped when no subscriptions exist', async () => {
    const d1 = createMockD1();
    d1.seedMembership('house-1', 'payer-user');
    d1.seedMembership('house-1', 'other-user');
    d1.seed('users', [{ id: 'payer-user', name: 'Alex' }]);
    // No push_subscriptions rows.

    const env = {
      DB: d1,
      VAPID_PUBLIC_KEY: 'BFake', VAPID_PRIVATE_KEY: 'fake', VAPID_SUBJECT: 'mailto:x@x',
    } as unknown as ExpensesEnv;

    let fetchCalls = 0;
    global.fetch = (vi.fn(async () => {
      fetchCalls++;
      return new Response(null, { status: 201 });
    }) as unknown) as typeof fetch;

    const { onRequestPost } = await import('../functions/api/expenses');
    const req = makeRequest(
      'http://test/api/expenses',
      {
        method: 'POST',
        body: JSON.stringify({
          household_id: 'house-1',
          title: 'Pizza', amount: 20, paid_by: 'payer-user',
          splits: [{ user_id: 'other-user', amount: 10 }],
        }),
      },
      'payer-user',
      'house-1'
    );
    const res = await runHandler(onRequestPost, req, env);
    expect(res.status).toBe(201);
    await new Promise(r => setTimeout(r, 0));
    expect(fetchCalls).toBe(0);
  });
});
