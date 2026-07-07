import { api } from './api/client';

export interface PresenceUser {
  clientId: string;
  userId: string;
  name: string;
  view: string;
  shopping: boolean;
  idle: boolean;
  lastSeen: number;
}

interface RealtimeOptions {
  onChanged: (message: any) => void;
  onPresence: (users: PresenceUser[]) => void;
  onStatus: (status: 'disconnected' | 'connecting' | 'connected' | 'fallback') => void;
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private householdId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private presence: { view?: string; shopping?: boolean; idle?: boolean } = {};
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private options: RealtimeOptions) {}

  connect(householdId: string | null) {
    if (!householdId) return this.disconnect();
    if (this.householdId === householdId && this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.disconnect();
    this.householdId = householdId;
    void this.open();
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.reconnectAttempt = 0;
    this.householdId = null;
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.options.onStatus('disconnected');
    this.options.onPresence([]);
  }

  setPresence(patch: { view?: string; shopping?: boolean; idle?: boolean }) {
    this.presence = { ...this.presence, ...patch };
    this.send({ t: 'presence.update', ...this.presence });
  }

  private async open() {
    if (!this.householdId) return;
    this.options.onStatus('connecting');
    try {
      const { token, wsUrl } = await api.realtime.token();
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const baseUrl = wsUrl || `${protocol}//${location.host}/api/realtime`;
      const separator = baseUrl.includes('?') ? '&' : '?';
      const ws = new WebSocket(`${baseUrl}${separator}token=${encodeURIComponent(token)}`);
      this.ws = ws;
      ws.onopen = () => {
        this.reconnectAttempt = 0;
        this.options.onStatus('connected');
        this.send({ t: 'presence.update', ...this.presence });
        this.pingTimer = setInterval(() => this.send({ t: 'ping' }), 30000);
      };
      ws.onmessage = (event) => this.handleMessage(event.data);
      ws.onclose = () => this.scheduleReconnect();
      ws.onerror = () => this.scheduleReconnect();
    } catch (e) {
      console.warn('Realtime unavailable, using polling fallback', e);
      this.options.onStatus('fallback');
      this.scheduleReconnect();
    }
  }

  private handleMessage(raw: string) {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t === 'changed') this.options.onChanged(msg);
    if (msg.t === 'presence.snapshot' && Array.isArray(msg.users)) this.options.onPresence(msg.users);
  }

  private send(message: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try { this.ws.send(JSON.stringify(message)); } catch {}
  }

  private scheduleReconnect() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (!this.householdId) return;
    if (this.reconnectTimer) return;
    this.options.onStatus('fallback');
    const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempt++));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, delay);
  }
}
