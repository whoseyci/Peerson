const encoder = new TextEncoder();

function base64Url(bytes: ArrayBuffer | Uint8Array) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  arr.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signBytes(secret: string, data: string) {
  const key = await hmacKey(secret);
  return crypto.subtle.sign('HMAC', key, encoder.encode(data));
}

export interface RealtimeTokenPayload {
  userId: string;
  userName: string;
  householdId: string;
  clientId: string;
  exp: number;
}

export async function signRealtimeToken(secret: string, payload: RealtimeTokenPayload) {
  const body = base64Url(encoder.encode(JSON.stringify(payload)));
  const sig = base64Url(await signBytes(secret, body));
  return `${body}.${sig}`;
}

export async function verifyRealtimeToken(secret: string, token: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<RealtimeTokenPayload | null> {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = base64Url(await signBytes(secret, body));
  if (expected !== sig) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as RealtimeTokenPayload;
    if (!payload.userId || !payload.householdId || !payload.clientId || !payload.exp) return null;
    if (payload.exp < nowSeconds) return null;
    return payload;
  } catch {
    return null;
  }
}
