export interface RealtimeMessage {
  t: string;
  [key: string]: unknown;
}

export interface RealtimeConnection {
  clientId: string;
  userId: string;
  userName: string;
  householdId: string;
  send: (message: RealtimeMessage) => void;
}

export interface PresenceUser {
  clientId: string;
  userId: string;
  name: string;
  view: string;
  shopping: boolean;
  idle: boolean;
  lastSeen: number;
}

interface StoredConnection extends RealtimeConnection {
  view: string;
  shopping: boolean;
  idle: boolean;
  lastSeen: number;
}

export class SyncHubCore {
  private connections = new Map<string, StoredConnection>();

  connect(conn: RealtimeConnection) {
    this.connections.set(conn.clientId, { ...conn, view: 'home', shopping: false, idle: false, lastSeen: Date.now() });
    this.broadcastPresence(conn.householdId);
  }

  disconnect(clientId: string) {
    const existing = this.connections.get(clientId);
    this.connections.delete(clientId);
    if (existing) this.broadcastPresence(existing.householdId);
  }

  updatePresence(clientId: string, patch: Partial<Pick<PresenceUser, 'view' | 'shopping' | 'idle'>>) {
    const conn = this.connections.get(clientId);
    if (!conn) return;
    if (typeof patch.view === 'string') conn.view = patch.view;
    if (typeof patch.shopping === 'boolean') conn.shopping = patch.shopping;
    if (typeof patch.idle === 'boolean') conn.idle = patch.idle;
    conn.lastSeen = Date.now();
    this.broadcastPresence(conn.householdId);
  }

  broadcast(householdId: string, message: RealtimeMessage, exceptClientId?: string) {
    for (const conn of this.connections.values()) {
      if (conn.householdId !== householdId || conn.clientId === exceptClientId) continue;
      conn.send(message);
    }
  }

  presenceForHousehold(householdId: string): PresenceUser[] {
    return Array.from(this.connections.values())
      .filter((conn) => conn.householdId === householdId)
      .map((conn) => ({
        clientId: conn.clientId,
        userId: conn.userId,
        name: conn.userName,
        view: conn.view,
        shopping: conn.shopping,
        idle: conn.idle,
        lastSeen: conn.lastSeen,
      }));
  }

  private broadcastPresence(householdId: string) {
    this.broadcast(householdId, { t: 'presence.snapshot', users: this.presenceForHousehold(householdId) });
  }
}
