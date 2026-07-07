import { describe, it, expect, vi, beforeEach } from 'vitest';
import { togglePushNotifications } from '../src/views/household';
import { getPushSubscriptionState } from '../src/utils/push';
import type { AppState, HouseholdMember } from '../src/types';

describe('Push Notifications UI & Subscribe/Unsubscribe E2E Flow (Issue #48)', () => {
  const members: HouseholdMember[] = [
    { id: 'u1', name: 'Alice', role: 'admin', joined_at: 0 },
  ];
  const validPub = 'BC-te_L0_DtGBsJ8mVXfRsy-GMM0S5B-4bER4p7XiQK7RfT5vk_j0L0N9KaZpDt7sBe5wROp1zc0ufOdfLYoPw0';

  function createMockApp() {
    const state: Partial<AppState> = {
      userId: 'u1',
      userName: 'Alice',
      householdId: 'h1',
      household: { id: 'h1', name: 'WG Mitte', invite_code: 'ABC12345', created_at: 0 },
      members: [...members],
      view: 'household',
    };
    const toasts: string[] = [];
    return {
      state: state as AppState,
      toasts,
      toast: (msg: string) => { toasts.push(msg); },
      render: vi.fn(),
      api: {
        push: {
          getConfig: vi.fn(async () => ({ configured: true, vapidPublicKey: validPub, subscriptions: [] })),
          subscribe: vi.fn(async () => ({ success: true })),
          unsubscribe: vi.fn(async () => ({ success: true })),
        },
      },
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('verifies getPushSubscriptionState detects push support and subscriptions correctly', async () => {
    const app = createMockApp();
    const mockSub = {
      endpoint: 'https://fcm.googleapis.com/test-endpoint',
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/test-endpoint', keys: { p256dh: 'p256', auth: 'auth' } }),
      unsubscribe: vi.fn(async () => true),
    };
    app.api.push.getConfig.mockResolvedValueOnce({ configured: true, vapidPublicKey: validPub, subscriptions: ['https://fcm.googleapis.com/test-endpoint'] });

    const mockSw = {
      getRegistration: vi.fn(async () => ({
        pushManager: {
          getSubscription: vi.fn(async () => mockSub),
        },
      })),
      register: vi.fn(),
      ready: Promise.resolve(),
    };

    (globalThis as any).localStorage = { getItem: () => 'u1', setItem: () => {}, removeItem: () => {} };
    (globalThis as any).window = { app, PushManager: {}, Notification: { permission: 'granted' }, atob: (str: string) => str };
    (globalThis as any).navigator = { serviceWorker: mockSw };
    (globalThis as any).Notification = { permission: 'granted' };

    const state = await getPushSubscriptionState();
    expect(state.supported).toBe(true);
    expect(state.configured).toBe(true);
    expect(state.subscribed).toBe(true);
    expect(state.permission).toBe('granted');
  });

  it('verifies togglePushNotifications(true) requests permission, subscribes via service worker, POSTs to server, and toasts success', async () => {
    const app = createMockApp();
    const mockSub = {
      endpoint: 'https://fcm.googleapis.com/new-sub',
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/new-sub', keys: { p256dh: 'new-pub-key', auth: 'new-auth-key' } }),
      unsubscribe: vi.fn(async () => true),
    };

    let requestedPerm = false;
    let registeredSw = false;
    let subscribedWithKey: any = null;

    const mockSw = {
      getRegistration: vi.fn(async () => null),
      register: vi.fn(async (url: string) => {
        registeredSw = true;
        return {
          pushManager: {
            getSubscription: vi.fn(async () => null),
            subscribe: vi.fn(async (opts: any) => {
              subscribedWithKey = opts.applicationServerKey;
              return mockSub;
            }),
          },
        };
      }),
      ready: Promise.resolve(),
    };

    (globalThis as any).localStorage = { getItem: () => 'u1', setItem: () => {}, removeItem: () => {} };
    (globalThis as any).window = {
      app,
      PushManager: {},
      Notification: {},
      atob: (str: string) => str,
    };
    (globalThis as any).navigator = { serviceWorker: mockSw };
    (globalThis as any).Notification = {
      permission: 'default',
      requestPermission: vi.fn(async () => {
        requestedPerm = true;
        (globalThis as any).Notification.permission = 'granted';
        return 'granted';
      }),
    };

    await togglePushNotifications(true);

    // 1. Confirms Notification.requestPermission() was called and granted
    expect(requestedPerm).toBe(true);

    // 2. Confirms service worker was registered
    expect(registeredSw).toBe(true);
    expect(mockSw.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });

    // 3. Confirms applicationServerKey was converted and passed to pushManager.subscribe
    expect(subscribedWithKey).toBeDefined();

    // 4. Confirms API call to /api/push-subscribe fired with well-formed body
    expect(app.api.push.subscribe).toHaveBeenCalledWith({
      household_id: 'h1',
      endpoint: 'https://fcm.googleapis.com/new-sub',
      keys: {
        p256dh: 'new-pub-key',
        auth: 'new-auth-key',
      },
    });

    // 5. Confirms toast lifecycle and app re-render
    expect(app.toasts).toContain('Benachrichtigungen werden aktiviert...');
    expect(app.toasts).toContain('Push-Benachrichtigungen aktiviert');
    expect(app.render).toHaveBeenCalled();
  });

  it('verifies togglePushNotifications(false) calls API to unsubscribe, unregisters browser sub, and toasts success', async () => {
    const app = createMockApp();
    let browserUnsubscribed = false;

    const mockSub = {
      endpoint: 'https://fcm.googleapis.com/active-sub',
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/active-sub', keys: { p256dh: 'pub', auth: 'auth' } }),
      unsubscribe: vi.fn(async () => { browserUnsubscribed = true; return true; }),
    };

    const mockSw = {
      getRegistration: vi.fn(async () => ({
        pushManager: {
          getSubscription: vi.fn(async () => mockSub),
        },
      })),
      register: vi.fn(),
      ready: Promise.resolve(),
    };

    (globalThis as any).localStorage = { getItem: () => 'u1', setItem: () => {}, removeItem: () => {} };
    (globalThis as any).window = { app, PushManager: {}, Notification: {}, atob: (s: string) => s };
    (globalThis as any).navigator = { serviceWorker: mockSw };
    (globalThis as any).Notification = { permission: 'granted' };

    await togglePushNotifications(false);

    // 1. Confirms API call to /api/push-unsubscribe fired with endpoint
    expect(app.api.push.unsubscribe).toHaveBeenCalledWith('https://fcm.googleapis.com/active-sub');

    // 2. Confirms browser subscription.unsubscribe() was called
    expect(browserUnsubscribed).toBe(true);

    // 3. Confirms toast lifecycle
    expect(app.toasts).toContain('Benachrichtigungen werden deaktiviert...');
    expect(app.toasts).toContain('Push-Benachrichtigungen deaktiviert');
  });
});
