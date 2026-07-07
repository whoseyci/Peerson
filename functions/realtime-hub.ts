import { verifyRealtimeToken, type RealtimeTokenPayload } from './realtime-auth';

export interface RealtimeEnv {
  REALTIME_TOKEN_SECRET?: string;
}

interface PresenceUser {
  clientId: string;
  userId: string;
  name: string;
  view: string;
  shopping: boolean;
  idle: boolean;
  lastSeen: number;
}

interface Attachment extends RealtimeTokenPayload {
  view: string;
  shopping: boolean;
  idle: boolean;
  lastSeen: number;
}

function json(message: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(message), { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
}

function readAttachment(ws: WebSocket): Attachment | null {
  try { return (ws as any).deserializeAttachment?.() || null; } catch { return null; }
}

function writeAttachment(ws: WebSocket, patch: Partial<Attachment>) {
  const current = readAttachment(ws);
  if (!current) return null;
  const next = { ...current, ...patch, lastSeen: Date.now() };
  try { (ws as any).serializeAttachment?.(next); } catch {}
  return next;
}

export class HouseholdSyncHub implements DurableObject {
  constructor(private state: DurableObjectState, private env: RealtimeEnv) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/notify')) return this.handleNotify(request);
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') return this.handleWebSocket(request);
    return json({ ok: true });
  }

  private async handleWebSocket(request: Request) {
    const secret = this.env.REALTIME_TOKEN_SECRET;
    if (!secret) return json({ error: 'REALTIME_TOKEN_SECRET not configured' }, { status: 501 });
    const token = new URL(request.url).searchParams.get('token') || '';
    const payload = await verifyRealtimeToken(secret, token);
    if (!payload) return json({ error: 'Invalid realtime token' }, { status: 403 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const attachment: Attachment = { ...payload, view: 'home', shopping: false, idle: false, lastSeen: Date.now() };
    try { (server as any).serializeAttachment?.(attachment); } catch {}

    // Hibernatable WebSockets keep idle DO cost low on Cloudflare. In local
    // tests/older runtimes, fall back to regular accept().
    if ((this.state as any).acceptWebSocket) (this.state as any).acceptWebSocket(server);
    else server.accept();

    this.send(server, { t: 'ready', householdId: payload.householdId, clientId: payload.clientId });
    this.broadcastPresence(payload.householdId);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleNotify(request: Request) {
    const body = await request.json<any>().catch(() => null);
    if (!body?.householdId) return json({ error: 'householdId required' }, { status: 400 });
    this.broadcast(body.householdId, {
      t: 'changed',
      resource: body.resource || 'data',
      action: body.action || 'change',
      by: body.actorUserId || null,
      eventId: body.eventId || crypto.randomUUID(),
      at: Date.now(),
    }, body.excludeClientId || undefined);
    return json({ ok: true });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const attachment = readAttachment(ws);
    if (!attachment || typeof message !== 'string') return;
    let parsed: any;
    try { parsed = JSON.parse(message); } catch { return; }
    if (parsed.t === 'presence.update') {
      const next = writeAttachment(ws, {
        view: typeof parsed.view === 'string' ? parsed.view : attachment.view,
        shopping: typeof parsed.shopping === 'boolean' ? parsed.shopping : attachment.shopping,
        idle: typeof parsed.idle === 'boolean' ? parsed.idle : attachment.idle,
      });
      if (next) this.broadcastPresence(next.householdId);
    } else if (parsed.t === 'ping') {
      writeAttachment(ws, {});
      this.send(ws, { t: 'pong', at: Date.now() });
    }
  }

  webSocketClose(ws: WebSocket) {
    const attachment = readAttachment(ws);
    if (attachment) this.broadcastPresence(attachment.householdId, ws);
  }

  webSocketError(ws: WebSocket) {
    const attachment = readAttachment(ws);
    if (attachment) this.broadcastPresence(attachment.householdId, ws);
  }

  private sockets() {
    if ((this.state as any).getWebSockets) return (this.state as any).getWebSockets() as WebSocket[];
    return [];
  }

  private presence(householdId: string, exclude?: WebSocket): PresenceUser[] {
    return this.sockets()
      .filter((ws) => ws !== exclude)
      .map(readAttachment)
      .filter((a): a is Attachment => !!a && a.householdId === householdId)
      .map((a) => ({ clientId: a.clientId, userId: a.userId, name: a.userName, view: a.view, shopping: a.shopping, idle: a.idle, lastSeen: a.lastSeen }));
  }

  private broadcastPresence(householdId: string, exclude?: WebSocket) {
    this.broadcast(householdId, { t: 'presence.snapshot', users: this.presence(householdId, exclude) }, undefined, exclude);
  }

  private broadcast(householdId: string, message: unknown, exceptClientId?: string, excludeSocket?: WebSocket) {
    for (const ws of this.sockets()) {
      if (ws === excludeSocket) continue;
      const attachment = readAttachment(ws);
      if (!attachment || attachment.householdId !== householdId || attachment.clientId === exceptClientId) continue;
      this.send(ws, message);
    }
  }

  private send(ws: WebSocket, message: unknown) {
    try { ws.send(JSON.stringify(message)); } catch {}
  }
}
