import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { signRealtimeToken, verifyRealtimeToken } from '../functions/realtime-auth';
import { SyncHubCore } from '../functions/realtime-core';
import { notifyHouseholdChanged } from '../functions/realtime-notify';

describe('realtime token auth', () => {
  it('signs and verifies short-lived household websocket tokens', async () => {
    const token = await signRealtimeToken('secret', { userId: 'u1', userName: 'Alice', householdId: 'h1', clientId: 'c1', exp: 200 });
    await expect(verifyRealtimeToken('secret', token, 100)).resolves.toMatchObject({ userId: 'u1', householdId: 'h1', clientId: 'c1' });
    await expect(verifyRealtimeToken('other', token, 100)).resolves.toBeNull();
    await expect(verifyRealtimeToken('secret', token, 300)).resolves.toBeNull();
  });
});

describe('SyncHubCore', () => {
  it('broadcasts only within a household and can exclude the sender', () => {
    const core = new SyncHubCore();
    const a: any[] = [], b: any[] = [], c: any[] = [];
    core.connect({ householdId: 'h1', userId: 'u1', userName: 'Alice', clientId: 'a', send: (m) => a.push(m) });
    core.connect({ householdId: 'h1', userId: 'u2', userName: 'Bob', clientId: 'b', send: (m) => b.push(m) });
    core.connect({ householdId: 'h2', userId: 'u3', userName: 'Cam', clientId: 'c', send: (m) => c.push(m) });

    core.broadcast('h1', { t: 'changed', resource: 'tasks' }, 'a');
    expect(a.some(m => m.t === 'changed')).toBe(false);
    expect(b.some(m => m.t === 'changed' && m.resource === 'tasks')).toBe(true);
    expect(c.some(m => m.t === 'changed')).toBe(false);
  });

  it('tracks shopping presence snapshots', () => {
    const core = new SyncHubCore();
    const messages: any[] = [];
    core.connect({ householdId: 'h1', userId: 'u1', userName: 'Alice', clientId: 'a', send: (m) => messages.push(m) });
    core.updatePresence('a', { view: 'shoppingTrip', shopping: true });
    expect(core.presenceForHousehold('h1')).toMatchObject([{ userId: 'u1', name: 'Alice', shopping: true, view: 'shoppingTrip' }]);
    expect(messages.some(m => m.t === 'presence.snapshot')).toBe(true);
  });
});

describe('realtime mutation route coverage', () => {
  const mutationRoutes = [
    'functions/api/items.ts',
    'functions/api/items/[id].ts',
    'functions/api/batches.ts',
    'functions/api/batches/[id].ts',
    'functions/api/batches/move.ts',
    'functions/api/tasks.ts',
    'functions/api/tasks/[id].ts',
    'functions/api/shopping.ts',
    'functions/api/shopping/[id].ts',
    'functions/api/expenses.ts',
    'functions/api/expenses/[id].ts',
    'functions/api/locations.ts',
    'functions/api/locations/[id].ts',
    'functions/api/category-budgets.ts',
  ];

  it('keeps realtime invalidation wired into important mutation routes', () => {
    for (const route of mutationRoutes) {
      const source = readFileSync(route, 'utf-8');
      expect(source, `${route} should import notifyHouseholdChanged`).toContain('notifyHouseholdChanged');
      expect(source, `${route} should pass X-Client-Id for sender exclusion`).toContain("X-Client-Id");
    }
  });
});

describe('notifyHouseholdChanged', () => {
  it('is a safe no-op when the Durable Object binding is absent', async () => {
    await expect(notifyHouseholdChanged({}, { householdId: 'h1', resource: 'tasks', action: 'update' })).resolves.toBeUndefined();
  });

  it('posts tiny invalidation payloads to the companion realtime Worker', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response('{}'));
    globalThis.fetch = fetchMock as any;
    try {
      await notifyHouseholdChanged({ REALTIME_NOTIFY_URL: 'https://rt.example/notify', REALTIME_NOTIFY_SECRET: 'notify-secret' }, { householdId: 'h1', resource: 'shopping', action: 'create', actorUserId: 'u1', excludeClientId: 'c1' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://rt.example/notify');
      expect(init.headers.Authorization).toBe('Bearer notify-secret');
      expect(JSON.parse(init.body)).toMatchObject({ householdId: 'h1', resource: 'shopping', action: 'create', actorUserId: 'u1', excludeClientId: 'c1' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
