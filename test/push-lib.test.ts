import { describe, it, expect } from 'vitest';
import {
  buildVapidHeaders,
  encryptPushPayload,
  sendPush,
  readVapidConfig,
  b64urlToBytes,
  bytesToB64url,
  type VapidKeys,
  type PushSubscriptionKeys,
} from '../functions/api/_pushLib';

// These tests exercise the Workers-runtime-native VAPID + Web Push
// encryption code on plain Node's webcrypto (Node 20 exposes the same
// `crypto.subtle` surface Cloudflare Workers do).

async function generateVapidKeys(): Promise<VapidKeys> {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwkPriv = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return {
    publicKey: bytesToB64url(rawPub),
    privateKey: jwkPriv.d!,
    subject: 'mailto:test@peerson.example',
  };
}

async function generateSubscriberKeypair(): Promise<{
  sub: PushSubscriptionKeys;
  privateKey: CryptoKey;
}> {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    sub: {
      endpoint: 'https://push.example.com/subscriptions/abc',
      p256dh: bytesToB64url(rawPub),
      auth: bytesToB64url(auth),
    },
    privateKey: kp.privateKey,
  };
}

describe('readVapidConfig', () => {
  it('returns null when any of the three env vars is missing', () => {
    expect(readVapidConfig({})).toBeNull();
    expect(readVapidConfig({ VAPID_PUBLIC_KEY: 'p' })).toBeNull();
    expect(readVapidConfig({ VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'x' })).toBeNull();
  });

  it('returns a full VapidKeys object when all three are present', () => {
    const cfg = readVapidConfig({
      VAPID_PUBLIC_KEY: 'pub',
      VAPID_PRIVATE_KEY: 'priv',
      VAPID_SUBJECT: 'mailto:a@b.c',
    });
    expect(cfg).toEqual({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.c' });
  });
});

describe('buildVapidHeaders (RFC 8292)', () => {
  it('produces a JWT that verifies against the VAPID public key', async () => {
    const vapid = await generateVapidKeys();
    const headers = await buildVapidHeaders('https://fcm.googleapis.com', vapid);
    expect(headers.Authorization).toMatch(/^vapid t=/);

    // Parse "vapid t=<jwt>, k=<publicKey>"
    const m = /^vapid t=([^,]+),\s*k=(.+)$/.exec(headers.Authorization);
    expect(m).toBeTruthy();
    const [, jwt, k] = m!;
    expect(k).toBe(vapid.publicKey);

    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
    expect(header.alg).toBe('ES256');
    expect(header.typ).toBe('JWT');
    expect(payload.aud).toBe('https://fcm.googleapis.com');
    expect(payload.sub).toBe(vapid.subject);
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // Verify the signature: import the public key and verify.
    const rawPub = b64urlToBytes(vapid.publicKey);
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'EC', crv: 'P-256',
        x: bytesToB64url(rawPub.slice(1, 33)),
        y: bytesToB64url(rawPub.slice(33, 65)),
        ext: true,
      },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const sig = b64urlToBytes(parts[2]);
    const signingInput = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      sig,
      signingInput
    );
    expect(ok).toBe(true);
  });
});

describe('encryptPushPayload (RFC 8291 aes128gcm)', () => {
  it('produces a well-formed aes128gcm content-encoded body', async () => {
    const { sub } = await generateSubscriberKeypair();
    const encrypted = await encryptPushPayload(sub, new TextEncoder().encode('hello'));

    // aes128gcm header: 16 (salt) + 4 (rs) + 1 (idlen) + 65 (as public) = 86 bytes,
    // then ciphertext = plaintext(5) + 1 delimiter + 16 GCM tag = 22 bytes for "hello".
    expect(encrypted.length).toBe(86 + 22);
    // Record size in big-endian at offset 16..20
    const dv = new DataView(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength);
    expect(dv.getUint32(16, false)).toBe(4096);
    // Key id length at offset 20
    expect(encrypted[20]).toBe(65);
    // The 65 bytes of the ephemeral public key start with the uncompressed
    // point marker 0x04.
    expect(encrypted[21]).toBe(0x04);
  });

  it('produces different output for the same input (fresh salt/keypair each call)', async () => {
    const { sub } = await generateSubscriberKeypair();
    const a = await encryptPushPayload(sub, new TextEncoder().encode('same'));
    const b = await encryptPushPayload(sub, new TextEncoder().encode('same'));
    expect(bytesToB64url(a)).not.toBe(bytesToB64url(b));
  });
});

describe('sendPush', () => {
  it('POSTs to the endpoint with the right Content-Encoding and TTL', async () => {
    const vapid = await generateVapidKeys();
    const { sub } = await generateSubscriberKeypair();

    let capturedInit: RequestInit | null = null;
    let capturedUrl = '';
    const fakeFetch: typeof fetch = async (url: any, init?: any) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(null, { status: 201 }) as any;
    };

    const res = await sendPush(sub, { hi: 'there' }, vapid, fakeFetch);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(201);
    expect(res.expired).toBe(false);

    expect(capturedUrl).toBe(sub.endpoint);
    const headers = (capturedInit as any).headers;
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(headers['Content-Type']).toBe('application/octet-stream');
    expect(headers.TTL).toBe('86400');
    expect(String(headers.Authorization)).toMatch(/^vapid t=/);
  });

  it('flags 404 and 410 responses as expired', async () => {
    const vapid = await generateVapidKeys();
    const { sub } = await generateSubscriberKeypair();
    const mkFetch = (status: number): typeof fetch =>
      async () => new Response(null, { status }) as any;
    const r404 = await sendPush(sub, {}, vapid, mkFetch(404));
    expect(r404.expired).toBe(true);
    expect(r404.ok).toBe(false);
    const r410 = await sendPush(sub, {}, vapid, mkFetch(410));
    expect(r410.expired).toBe(true);
    const r500 = await sendPush(sub, {}, vapid, mkFetch(500));
    expect(r500.expired).toBe(false);
    expect(r500.ok).toBe(false);
  });
});
