// Pure testable core for the WebSocket sync hub and presence tracker.
// Factored cleanly away from the Cloudflare runtime APIs so it can be
// unit-tested with dependency-injected fake sockets (see test/durable-sync-hub.test.ts).

export interface SyncEvent {
  type: string;
  householdId: string;
  payload?: any;
}

export interface OnlineUser {
  userId: string;
  userName: string;
}

export interface ClientSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState?: number;
}

export class SyncHubCore {
  private clients = new Map<ClientSocket, OnlineUser>();

  addClient(socket: ClientSocket, userId: string, userName: string): void {
    this.clients.set(socket, { userId, userName });
    this.broadcastPresence();
  }

  removeClient(socket: ClientSocket): void {
    if (this.clients.has(socket)) {
      this.clients.delete(socket);
      this.broadcastPresence();
    }
  }

  getOnlineUsers(): OnlineUser[] {
    const byId = new Map<string, OnlineUser>();
    for (const u of this.clients.values()) {
      if (u.userId && !byId.has(u.userId)) {
        byId.set(u.userId, u);
      }
    }
    return Array.from(byId.values());
  }

  broadcast(event: SyncEvent, excludeSocket?: ClientSocket): number {
    const msg = JSON.stringify(event);
    let notifiedCount = 0;
    const deadSockets: ClientSocket[] = [];

    for (const [sock] of this.clients.entries()) {
      if (excludeSocket && sock === excludeSocket) continue;
      try {
        if (sock.readyState === undefined || sock.readyState === 1) { // 1 = OPEN in WebSocket standard
          sock.send(msg);
          notifiedCount++;
        } else {
          deadSockets.push(sock);
        }
      } catch {
        deadSockets.push(sock);
      }
    }

    for (const dead of deadSockets) {
      this.removeClient(dead);
    }

    return notifiedCount;
  }

  private broadcastPresence(): void {
    const onlineUsers = this.getOnlineUsers();
    // Use an internal silent broadcast without triggering recursive loops
    const msg = JSON.stringify({
      type: 'presence.updated',
      householdId: 'hub',
      payload: { onlineUsers }
    });
    const deadSockets: ClientSocket[] = [];
    for (const [sock] of this.clients.entries()) {
      try {
        if (sock.readyState === undefined || sock.readyState === 1) {
          sock.send(msg);
        } else {
          deadSockets.push(sock);
        }
      } catch {
        deadSockets.push(sock);
      }
    }
    for (const dead of deadSockets) {
      this.clients.delete(dead);
    }
  }
}

// Cloudflare Durable Object implementation wrapping SyncHubCore
export class HouseholdSyncHub {
  private core = new SyncHubCore();
  private state: any;

  constructor(state: any, env: any) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade endpoint: GET /ws?userId=...&userName=...
    if (url.pathname === '/ws' || request.headers.get('Upgrade') === 'websocket') {
      const userId = url.searchParams.get('userId') || 'anon';
      const userName = url.searchParams.get('userName') || 'Anonymous';

      const pair = new (globalThis as any).WebSocketPair();
      const [clientWs, serverWs] = Object.values(pair) as [any, any];

      serverWs.accept();
      this.core.addClient(serverWs, userId, userName);

      serverWs.addEventListener('close', () => {
        this.core.removeClient(serverWs);
      });
      serverWs.addEventListener('error', () => {
        this.core.removeClient(serverWs);
      });

      return new Response(null, { status: 101, webSocket: clientWs } as any);
    }

    // Internal notification endpoint: POST /notify
    if (url.pathname === '/notify' && request.method === 'POST') {
      try {
        const event = await request.json<SyncEvent>();
        const count = this.core.broadcast(event);
        return Response.json({ notified: count, onlineUsers: this.core.getOnlineUsers() });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid notification payload' }), { status: 400 });
      }
    }

    return new Response('HouseholdSyncHub running', { status: 200 });
  }
}
