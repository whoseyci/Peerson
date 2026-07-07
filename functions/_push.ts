import { buildPushHTTPRequest } from '@pushforge/builder';
import type { Env } from './_middleware';

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  household_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  view?: string;
  tag?: string;
}

/**
 * Converts standard base64url or JSON string VAPID private key into a JWK for @pushforge/builder.
 */
export async function getVapidPrivateJWK(privateKeyEnv: string, publicKeyEnv: string): Promise<JsonWebKey> {
  const trimmed = privateKeyEnv.trim();
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed); } catch (e) {
      throw new Error('Invalid VAPID_PRIVATE_KEY JSON');
    }
  }

  // Raw base64url scalar d (32 bytes) and uncompressed point 0x04 + x + y (65 bytes)
  const pubBytes = new Uint8Array(Buffer.from(publicKeyEnv.trim(), 'base64url'));
  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) {
    throw new Error('Invalid VAPID_PUBLIC_KEY format (expected 65 uncompressed EC bytes)');
  }

  const x = Buffer.from(pubBytes.slice(1, 33)).toString('base64url');
  const y = Buffer.from(pubBytes.slice(33, 65)).toString('base64url');

  return {
    kty: 'EC',
    crv: 'P-256',
    x,
    y,
    d: trimmed,
    ext: true,
    key_ops: ['sign'],
  };
}

/**
 * Sends a push notification to a single subscription endpoint using Web Crypto and VAPID.
 */
export async function sendPushNotification(
  env: Env,
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload
): Promise<{ success: boolean; status?: number; expired?: boolean }> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return { success: false };
  }

  try {
    const jwk = await getVapidPrivateJWK(env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY);
    const subject = env.VAPID_SUBJECT || 'mailto:admin@peerson.app';

    const req = await buildPushHTTPRequest({
      privateJWK: jwk as any,
      message: {
        payload: JSON.stringify(payload),
        adminContact: subject,
      },
      subscription: {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      },
    });

    const res = await fetch(req.endpoint, {
      method: 'POST',
      headers: req.headers as any,
      body: req.body,
    });

    if (res.status === 404 || res.status === 410) {
      return { success: false, status: res.status, expired: true };
    }

    return { success: res.ok, status: res.status };
  } catch (err) {
    console.error('sendPushNotification error:', err);
    return { success: false };
  }
}

/**
 * Sends a push notification to all subscriptions of a specific user in a household.
 * Cleans up expired/invalid subscriptions automatically.
 */
export async function sendPushToUser(
  env: Env,
  userId: string,
  householdId: string,
  payload: PushPayload
): Promise<{ sent: number; expiredRemoved: number }> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return { sent: 0, expiredRemoved: 0 };
  }

  let subs: PushSubscriptionRow[] = [];
  try {
    const res = await env.DB.prepare('SELECT * FROM push_subscriptions WHERE user_id = ? AND household_id = ?')
      .bind(userId, householdId).all();
    subs = (res.results || []) as PushSubscriptionRow[];
  } catch (e: any) {
    if (!e?.message?.includes('no such table')) return { sent: 0, expiredRemoved: 0 };
    throw e;
  }

  let sent = 0;
  let expiredRemoved = 0;

  for (const sub of subs) {
    const result = await sendPushNotification(env, sub, payload);
    if (result.success) {
      sent++;
    } else if (result.expired) {
      try {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run();
        expiredRemoved++;
      } catch (e) {}
    }
  }

  return { sent, expiredRemoved };
}

/**
 * Sends immediate notifications when a new expense is logged.
 */
export async function sendExpenseNotifications(
  env: Env,
  householdId: string,
  payerId: string,
  title: string,
  amount: number,
  recipientIds: string[]
): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !recipientIds || recipientIds.length === 0) return;

  let payerName = 'Ein Mitglied';
  try {
    const payer = await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(payerId).first();
    if (payer && payer.name) payerName = payer.name;
  } catch (e) {}

  const formattedAmount = typeof amount === 'number' ? amount.toFixed(2) : String(amount);
  const payload: PushPayload = {
    title: `Neue Ausgabe: ${title}`,
    body: `${payerName} hat ${formattedAmount} € eingetragen`,
    view: 'expenses',
    tag: `expense-${Date.now()}`,
  };

  for (const recipientId of recipientIds) {
    if (recipientId === payerId) continue;
    try {
      await sendPushToUser(env, recipientId, householdId, payload);
    } catch (e) {}
  }
}
