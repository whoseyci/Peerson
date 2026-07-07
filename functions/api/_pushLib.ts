// Web Push helper for Cloudflare Pages Functions (Issue #48).
//
// Why a hand-rolled implementation? The popular `web-push` npm package
// assumes Node's `crypto` (ECDH object, Buffers, etc.) and does not run
// unchanged on the Cloudflare Workers runtime. Everything below is built
// against the standard **Web Crypto API**, which IS available in
// Workers/Pages Functions (`crypto.subtle`), so this module has zero
// third-party dependencies and works in production on Cloudflare.
//
// This implements two RFCs:
//   • RFC 8292 (VAPID): sign a short-lived JWT with the server's private
//     key and send it in the `Authorization: vapid` header so the push
//     service knows which app is sending.
//   • RFC 8291 (Web Push Encryption, `aes128gcm` content encoding): use
//     an ephemeral ECDH keypair to derive a symmetric AES-GCM key
//     shared with the subscriber's browser and encrypt the payload
//     end-to-end so the push service never sees plaintext.
//
// File is named `_pushLib.ts` (leading underscore = not routed by Pages
// Functions; the substring `Lib` is NOT `lib/`, which matters because
// `test/build.test.ts` explicitly bans imports whose path contains
// `lib/` and this file is imported by sibling handlers.

// -------------------------------------------------------------------
// Base64URL <-> bytes helpers.
// -------------------------------------------------------------------

export function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// -------------------------------------------------------------------
// EC key helpers. Web Push keys are P-256 (secp256r1 / prime256v1).
// -------------------------------------------------------------------

// A "raw" P-256 public key is a 65-byte uncompressed point: 0x04 || X || Y.
// We import it as a JWK because WebCrypto's importKey('raw', ...) does not
// accept EC keys in every runtime.
async function importP256PublicKey(rawBytes: Uint8Array): Promise<CryptoKey> {
  if (rawBytes.length !== 65 || rawBytes[0] !== 0x04) {
    throw new Error('Invalid raw P-256 public key (expected 65-byte uncompressed point)');
  }
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToB64url(rawBytes.slice(1, 33)),
    y: bytesToB64url(rawBytes.slice(33, 65)),
    ext: true,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}

// VAPID private key is 32 raw bytes (d). WebCrypto wants a JWK with x/y too
// (the public key is required even when only signing), which we derive by
// reversing the multiplication ourselves? Not needed — the caller always
// hands us both public and private key bytes, so we take both and build a
// full private-key JWK.
async function importP256PrivateKey(dBytes: Uint8Array, publicRawBytes: Uint8Array): Promise<CryptoKey> {
  if (dBytes.length !== 32) throw new Error('Invalid VAPID private key length (expected 32 bytes)');
  if (publicRawBytes.length !== 65 || publicRawBytes[0] !== 0x04) {
    throw new Error('Invalid VAPID public key (expected 65-byte uncompressed point)');
  }
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: bytesToB64url(dBytes),
    x: bytesToB64url(publicRawBytes.slice(1, 33)),
    y: bytesToB64url(publicRawBytes.slice(33, 65)),
    ext: true,
  };
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

async function exportRawPublicKey(key: CryptoKey): Promise<Uint8Array> {
  // For ECDH keys, exportKey('raw', ...) returns the 65-byte uncompressed
  // point. For ECDSA keys, some runtimes disallow 'raw' — but we only ever
  // need to export ECDH ephemeral keys here.
  const raw = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(raw);
}

// -------------------------------------------------------------------
// HKDF (RFC 5869) using WebCrypto. We can't use SubtleCrypto's HKDF
// mode directly for our specific "small info string" derivations because
// it insists on producing a full symmetric key — easier to do it by
// hand with HMAC-SHA-256 primitives.
// -------------------------------------------------------------------

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    'raw',
    key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', k, data);
  return new Uint8Array(sig);
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  const prk = await hmacSha256(salt, ikm);
  // Only need one iteration for length <= 32 (our derivations are all 16 or 32 bytes).
  const t = await hmacSha256(prk, concatBytes(info, new Uint8Array([0x01])));
  return t.slice(0, length);
}

// -------------------------------------------------------------------
// VAPID JWT signing (RFC 8292 § 2).
// -------------------------------------------------------------------

// Convert an ECDSA signature from ASN.1 DER (some runtimes) to the raw
// r||s form the JWT spec requires. WebCrypto in Workers already returns
// the raw form (64 bytes for P-256), so this is a safety no-op; kept
// small in case a runtime ever surprises us.
function ecdsaSignatureToJose(sig: Uint8Array): Uint8Array {
  if (sig.length === 64) return sig;
  // Very light DER parser for the ECDSA-Sig-Value SEQUENCE(INTEGER r, INTEGER s).
  if (sig[0] !== 0x30) throw new Error('Unexpected ECDSA signature format');
  let offset = 2;
  if (sig[1] & 0x80) offset = 2 + (sig[1] & 0x7f);
  const readInt = (o: number) => {
    if (sig[o] !== 0x02) throw new Error('Bad ECDSA INTEGER tag');
    const len = sig[o + 1];
    let start = o + 2;
    let end = start + len;
    // Strip leading zero used to keep the integer positive.
    while (end - start > 32 && sig[start] === 0x00) start++;
    const buf = new Uint8Array(32);
    buf.set(sig.slice(start, end), 32 - (end - start));
    return { buf, next: end };
  };
  const r = readInt(offset);
  const s = readInt(r.next);
  return concatBytes(r.buf, s.buf);
}

export interface VapidKeys {
  publicKey: string;   // Base64URL of 65-byte uncompressed EC point (starts with "B...")
  privateKey: string;  // Base64URL of 32-byte scalar
  subject: string;     // mailto:... or https://... URL, per RFC 8292 § 2.1
}

/**
 * Build the two headers a Web Push request needs when using VAPID:
 * Authorization: vapid t=<JWT>, k=<publicKey>
 * (`aes128gcm` content coding puts VAPID into the Authorization header,
 * not the older Crypto-Key header.)
 */
export async function buildVapidHeaders(
  audience: string,
  vapid: VapidKeys,
  ttlSec = 12 * 60 * 60
): Promise<{ Authorization: string }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: audience, exp: nowSec + ttlSec, sub: vapid.subject };

  const enc = new TextEncoder();
  const headerB64 = bytesToB64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = bytesToB64url(enc.encode(JSON.stringify(payload)));
  const signingInput = enc.encode(`${headerB64}.${payloadB64}`);

  const pubBytes = b64urlToBytes(vapid.publicKey);
  const privBytes = b64urlToBytes(vapid.privateKey);
  const privateKey = await importP256PrivateKey(privBytes, pubBytes);

  const rawSig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, signingInput)
  );
  const jwsSig = ecdsaSignatureToJose(rawSig);
  const jwt = `${headerB64}.${payloadB64}.${bytesToB64url(jwsSig)}`;
  return { Authorization: `vapid t=${jwt}, k=${vapid.publicKey}` };
}

// -------------------------------------------------------------------
// Web Push message encryption (RFC 8291, aes128gcm content coding).
// -------------------------------------------------------------------

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string; // Base64URL of the browser's public key (65 raw bytes)
  auth: string;   // Base64URL of the browser's 16-byte auth secret
}

/**
 * Encrypt a UTF-8 payload for a specific subscription.
 * Returns the body bytes to POST to `subscription.endpoint`. The Web Push
 * request must also carry `Content-Encoding: aes128gcm` and
 * `Content-Type: application/octet-stream` (`sendPush` below sets both).
 */
export async function encryptPushPayload(
  sub: PushSubscriptionKeys,
  payload: Uint8Array
): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(sub.p256dh);
  const authSecret = b64urlToBytes(sub.auth);

  // Fresh ECDH keypair per message (aka "as public key" in RFC 8291).
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const asPublicRaw = await exportRawPublicKey(ephemeral.publicKey);

  // Salt is 16 random bytes.
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // ECDH shared secret with the subscriber.
  const uaPubKey = await importP256PublicKey(uaPublic);
  const ecdhSecretBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaPubKey } as any,
    ephemeral.privateKey,
    256
  );
  const ecdhSecret = new Uint8Array(ecdhSecretBits);

  // Per RFC 8291 § 3.3:
  //   PRK_key = HMAC-SHA-256(auth_secret, ecdh_secret)
  //   key_info = "WebPush: info\0" || ua_public || as_public
  //   IKM = HMAC-SHA-256(PRK_key, key_info || 0x01)
  const enc = new TextEncoder();
  const keyInfo = concatBytes(
    enc.encode('WebPush: info\0'),
    uaPublic,
    asPublicRaw
  );
  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  // (The two lines above compute the same thing two ways; keeping the
  // second — a proper HKDF — because that's what the RFC prescribes.
  // `prkKey` is used implicitly inside `hkdf`; the variable itself is
  // unused. Left here as documentation of the intermediate value.)
  void prkKey;

  // Content encryption key: HKDF(salt, IKM, "Content-Encoding: aes128gcm\0", 16)
  const cek = await hkdf(
    salt,
    ikm,
    enc.encode('Content-Encoding: aes128gcm\0'),
    16
  );

  // Nonce: HKDF(salt, IKM, "Content-Encoding: nonce\0", 12)
  const nonce = await hkdf(
    salt,
    ikm,
    enc.encode('Content-Encoding: nonce\0'),
    12
  );

  // aes128gcm framing: plaintext || 0x02 (single-record delimiter, since we
  // send everything in one record and it's the last).
  const framed = concatBytes(payload, new Uint8Array([0x02]));

  const aesKey = await crypto.subtle.importKey(
    'raw',
    cek.buffer.slice(cek.byteOffset, cek.byteOffset + cek.byteLength) as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      aesKey,
      framed
    )
  );

  // Assemble the aes128gcm content-coding header:
  //   salt(16) || record_size(4, big-endian) || key_id_len(1, = 65) || as_public(65) || ciphertext
  // Record size just needs to be >= plaintext+17 for us (single record); 4096 is standard.
  const recordSize = 4096;
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, recordSize, false);
  const header = concatBytes(salt, rs, new Uint8Array([asPublicRaw.length]), asPublicRaw);
  return concatBytes(header, ciphertext);
}

// -------------------------------------------------------------------
// Sending. Returns the push service's HTTP status so the caller can
// clean up expired subscriptions (404/410) from the DB.
// -------------------------------------------------------------------

export interface PushSendResult {
  status: number;
  ok: boolean;
  /** True iff the push service told us this subscription is gone for good. */
  expired: boolean;
}

export async function sendPush(
  sub: PushSubscriptionKeys,
  payload: Record<string, unknown> | string,
  vapid: VapidKeys,
  fetchImpl: typeof fetch = fetch
): Promise<PushSendResult> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const encrypted = await encryptPushPayload(sub, new TextEncoder().encode(body));

  const audience = new URL(sub.endpoint).origin;
  const vapidHeaders = await buildVapidHeaders(audience, vapid);
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      ...vapidHeaders,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
    },
    body: encrypted,
  });
  return { status: res.status, ok: res.ok, expired: res.status === 404 || res.status === 410 };
}

// -------------------------------------------------------------------
// Env-based configuration helper. VAPID keys are optional -- if any of
// the three env vars is missing, the whole push feature is disabled and
// endpoints return 501 with a clear message (mirroring the pattern used
// by functions/api/bug-report.ts and functions/api/receipt-scan.ts).
// -------------------------------------------------------------------

export interface PushEnv {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export function readVapidConfig(env: PushEnv): VapidKeys | null {
  const pub = env.VAPID_PUBLIC_KEY;
  const priv = env.VAPID_PRIVATE_KEY;
  const sub = env.VAPID_SUBJECT;
  if (!pub || !priv || !sub) return null;
  return { publicKey: pub, privateKey: priv, subject: sub };
}
