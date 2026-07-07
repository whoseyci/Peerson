import type { PagesFunction } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  REALTIME_TOKEN_SECRET?: string;
  REALTIME_WS_URL?: string;
  REALTIME_NOTIFY_URL?: string;
  REALTIME_NOTIFY_SECRET?: string;
}

function corsOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (!origin) return requestUrl.origin;

  try {
    const originUrl = new URL(origin);
    const sameHost = originUrl.host === requestUrl.host;
    const localDev = ['localhost', '127.0.0.1'].includes(originUrl.hostname);
    return sameHost || localDev ? origin : requestUrl.origin;
  } catch {
    return requestUrl.origin;
  }
}

function applySecurityHeaders(response: Response, request: Request) {
  const origin = corsOrigin(request);
  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-User-Id, X-User-Name, X-Household-Id, X-Client-Id');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  response.headers.set('Vary', 'Origin');

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  response.headers.set('X-Frame-Options', 'DENY');
  return response;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === 'OPTIONS') {
    return applySecurityHeaders(new Response(null, { status: 204 }), context.request);
  }

  const response = await context.next();
  return applySecurityHeaders(response, context.request);
};
