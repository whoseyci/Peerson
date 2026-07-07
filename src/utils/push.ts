// Client-side Web Push helper (Issue #48).
//
// Responsibilities:
//   - Feature-detect support (Notification / PushManager / ServiceWorker).
//   - Register the service worker at /sw.js once.
//   - Fetch the server's VAPID public key + "is push configured?" flag.
//   - Subscribe / unsubscribe the current browser and mirror the state
//     into the backend via /api/push-subscribe & /api/push-unsubscribe.
//   - Persist the user's opt-in preference in localStorage under
//     `peerson_pushEnabled` (mirrors how `peerson_darkMode` is persisted
//     in src/app.ts — a per-device, per-browser boolean).
//
// This module deliberately does NOT touch the DOM; the household view
// (src/views/household.ts) calls into it from its toggle handler and
// renders a message based on the returned state.

const STORAGE_KEY = 'peerson_pushEnabled';

export interface PushSupport {
  supported: boolean;
  /** Non-empty when we know why push isn't available on this device. */
  reason?: string;
}

export interface PushConfig {
  configured: boolean;
  publicKey: string | null;
}

export type PushStatus =
  | { state: 'unsupported'; reason: string }
  | { state: 'unconfigured' }              // server has no VAPID keys set
  | { state: 'denied' }                    // user blocked notifications
  | { state: 'off' }                       // user hasn't opted in (or opted out)
  | { state: 'on'; endpoint: string };     // opted in and PushManager has a subscription

export function detectSupport(): PushSupport {
  if (typeof window === 'undefined') return { supported: false, reason: 'no window' };
  if (!('serviceWorker' in navigator)) return { supported: false, reason: 'Service Worker nicht unterstützt' };
  if (!('PushManager' in window)) return { supported: false, reason: 'Push API nicht unterstützt' };
  if (!('Notification' in window)) return { supported: false, reason: 'Notifications nicht unterstützt' };
  return { supported: true };
}

export function getStoredPreference(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
}

export function setStoredPreference(enabled: boolean): void {
  try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch { /* private mode */ }
}

let swRegistrationPromise: Promise<ServiceWorkerRegistration> | null = null;

export function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker.register('/sw.js').then(async reg => {
      await navigator.serviceWorker.ready;
      return reg;
    });
  }
  return swRegistrationPromise;
}

let cachedConfig: PushConfig | null = null;

export async function fetchPushConfig(): Promise<PushConfig> {
  if (cachedConfig) return cachedConfig;
  const res = await fetch('/api/push-config');
  if (!res.ok) return { configured: false, publicKey: null };
  cachedConfig = await res.json();
  return cachedConfig!;
}

function b64urlToUint8Array(b64url: string): Uint8Array {
  const padding = '='.repeat((4 - (b64url.length % 4)) % 4);
  const base64 = (b64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function subscriptionKey(sub: PushSubscription, name: 'p256dh' | 'auth'): string {
  const raw = sub.getKey(name);
  if (!raw) return '';
  const bytes = new Uint8Array(raw);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-User-Id': localStorage.getItem('peerson_userId') || '',
    'X-User-Name': localStorage.getItem('peerson_userName') || '',
    'X-Household-Id': localStorage.getItem('peerson_householdId') || '',
  };
}

/**
 * Look up the current status without mutating anything (no permission
 * prompts, no subscribe calls). Safe to call whenever rendering the
 * settings screen.
 */
export async function getPushStatus(): Promise<PushStatus> {
  const support = detectSupport();
  if (!support.supported) return { state: 'unsupported', reason: support.reason || 'nicht unterstützt' };

  const cfg = await fetchPushConfig();
  if (!cfg.configured) return { state: 'unconfigured' };

  if (Notification.permission === 'denied') return { state: 'denied' };

  const reg = await ensureServiceWorker();
  const existing = await reg.pushManager.getSubscription();
  if (existing && getStoredPreference()) return { state: 'on', endpoint: existing.endpoint };
  return { state: 'off' };
}

/**
 * Ask the browser for permission (if not already granted), create a
 * PushManager subscription, and register it server-side.
 */
export async function enablePush(): Promise<PushStatus> {
  const support = detectSupport();
  if (!support.supported) throw new Error(support.reason || 'Push nicht unterstützt');

  const cfg = await fetchPushConfig();
  if (!cfg.configured || !cfg.publicKey) throw new Error('Server-seitig nicht konfiguriert');

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Benachrichtigungen wurden abgelehnt');

  const reg = await ensureServiceWorker();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast is only for TS lib.d.ts's stricter ArrayBufferView<ArrayBuffer>
      // constraint — at runtime PushManager accepts any Uint8Array.
      applicationServerKey: b64urlToUint8Array(cfg.publicKey) as unknown as BufferSource,
    });
  }

  const p256dh = subscriptionKey(sub, 'p256dh');
  const auth = subscriptionKey(sub, 'auth');
  const res = await fetch('/api/push-subscribe', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh, auth } }),
  });
  if (!res.ok) {
    // Best-effort rollback: if the server rejected us, unregister the
    // local subscription so the browser doesn't think it's active.
    try { await sub.unsubscribe(); } catch { /* ignore */ }
    if (res.status === 501) throw new Error('Server-seitig nicht konfiguriert');
    throw new Error('Anmeldung fehlgeschlagen');
  }

  setStoredPreference(true);
  return { state: 'on', endpoint: sub.endpoint };
}

/**
 * Remove the server-side row AND unsubscribe from PushManager locally.
 */
export async function disablePush(): Promise<PushStatus> {
  setStoredPreference(false);
  const support = detectSupport();
  if (!support.supported) return { state: 'unsupported', reason: support.reason || 'nicht unterstützt' };
  const reg = await ensureServiceWorker();
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    // Tell the server first — if it errors we still want to blow away
    // the browser-side subscription so we don't get "off" in the UI
    // but keep silently receiving pushes.
    try {
      await fetch('/api/push-unsubscribe', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
    } catch { /* offline etc. */ }
    try { await sub.unsubscribe(); } catch { /* ignore */ }
  }
  return { state: 'off' };
}
