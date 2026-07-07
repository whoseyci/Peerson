import { HouseholdSyncHub } from '../functions/realtime-hub';
import { verifyRealtimeToken } from '../functions/realtime-auth';

export { HouseholdSyncHub };

interface Env {
  SYNC_HUB: DurableObjectNamespace;
  REALTIME_TOKEN_SECRET: string;
  REALTIME_NOTIFY_SECRET: string;
}

function json(message: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(message), { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
}

function bearer(request: Request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') return json({ ok: true });

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket upgrade required' }, { status: 426 });
      const token = url.searchParams.get('token') || '';
      const payload = await verifyRealtimeToken(env.REALTIME_TOKEN_SECRET, token);
      if (!payload) return json({ error: 'Invalid realtime token' }, { status: 403 });
      return env.SYNC_HUB.get(env.SYNC_HUB.idFromName(payload.householdId)).fetch(request);
    }

    if (url.pathname === '/notify') {
      if (!env.REALTIME_NOTIFY_SECRET || bearer(request) !== env.REALTIME_NOTIFY_SECRET) {
        return json({ error: 'Forbidden' }, { status: 403 });
      }
      const body = await request.clone().json<any>().catch(() => null);
      if (!body?.householdId) return json({ error: 'householdId required' }, { status: 400 });
      return env.SYNC_HUB.get(env.SYNC_HUB.idFromName(body.householdId)).fetch(request);
    }

    return json({ error: 'Not found' }, { status: 404 });
  },
};
