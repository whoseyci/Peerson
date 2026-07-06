import { describe, it, expect, vi } from 'vitest';
import { SyncHubCore, type ClientSocket } from '../functions/durable/householdSyncHub';
import { notifyHouseholdSync } from '../functions/durable/notifyHub';

class FakeSocket implements ClientSocket {
  sent: string[] = [];
  readyState = 1;
  shouldThrow = false;

  send(data: string): void {
    if (this.shouldThrow) throw new Error('Socket closed');
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }
}

describe('SyncHubCore (WebSocket Hub & Presence)', () => {
  it('adds clients and broadcasts presence updates', () => {
    const hub = new SyncHubCore();
    const sock1 = new FakeSocket();
    const sock2 = new FakeSocket();

    hub.addClient(sock1, 'u1', 'Alice');
    expect(sock1.sent).toHaveLength(1);
    expect(JSON.parse(sock1.sent[0]).type).toBe('presence.updated');
    expect(JSON.parse(sock1.sent[0]).payload.onlineUsers).toEqual([{ userId: 'u1', userName: 'Alice' }]);

    hub.addClient(sock2, 'u2', 'Bob');
    // sock1 should receive second presence broadcast containing both Alice and Bob
    expect(sock1.sent).toHaveLength(2);
    expect(JSON.parse(sock1.sent[1]).payload.onlineUsers).toHaveLength(2);
  });

  it('deduplicates multiple sockets from the same user ID in online presence', () => {
    const hub = new SyncHubCore();
    const phoneSock = new FakeSocket();
    const laptopSock = new FakeSocket();

    hub.addClient(phoneSock, 'u1', 'Alice');
    hub.addClient(laptopSock, 'u1', 'Alice');

    const online = hub.getOnlineUsers();
    expect(online).toEqual([{ userId: 'u1', userName: 'Alice' }]);
  });

  it('removes clients and broadcasts updated presence when a socket disconnects', () => {
    const hub = new SyncHubCore();
    const sock1 = new FakeSocket();
    const sock2 = new FakeSocket();

    hub.addClient(sock1, 'u1', 'Alice');
    hub.addClient(sock2, 'u2', 'Bob');
    expect(hub.getOnlineUsers()).toHaveLength(2);

    hub.removeClient(sock2);
    expect(hub.getOnlineUsers()).toEqual([{ userId: 'u1', userName: 'Alice' }]);
    expect(JSON.parse(sock1.sent[sock1.sent.length - 1]).payload.onlineUsers).toHaveLength(1);
  });

  it('broadcasts sync events to all connected sockets except the sender', () => {
    const hub = new SyncHubCore();
    const sender = new FakeSocket();
    const receiver1 = new FakeSocket();
    const receiver2 = new FakeSocket();

    hub.addClient(sender, 'u1', 'Alice');
    hub.addClient(receiver1, 'u2', 'Bob');
    hub.addClient(receiver2, 'u3', 'Charlie');

    const notifiedCount = hub.broadcast(
      { type: 'item.created', householdId: 'h1', payload: { id: 'item-1' } },
      sender
    );

    expect(notifiedCount).toBe(2);
    // sender received 3 presence updates during addClient calls, but 0 item.created broadcasts
    expect(sender.sent.some(s => s.includes('item.created'))).toBe(false);
    // receiver1 and receiver2 received the broadcast
    expect(receiver1.sent.some(s => s.includes('item.created'))).toBe(true);
    expect(receiver2.sent.some(s => s.includes('item.created'))).toBe(true);
  });

  it('automatically cleans up dead or errored sockets during broadcast', () => {
    const hub = new SyncHubCore();
    const alive = new FakeSocket();
    const dead = new FakeSocket();
    const errored = new FakeSocket();

    hub.addClient(alive, 'u1', 'Alice');
    hub.addClient(dead, 'u2', 'Bob');
    hub.addClient(errored, 'u3', 'Charlie');

    expect(hub.getOnlineUsers()).toHaveLength(3);

    // Now they die/error before next broadcast
    dead.readyState = 3;
    errored.shouldThrow = true;

    const notified = hub.broadcast({ type: 'task.updated', householdId: 'h1' });
    expect(notified).toBe(1); // only alive was notified
    // dead and errored sockets should be purged from the hub
    expect(hub.getOnlineUsers()).toEqual([{ userId: 'u1', userName: 'Alice' }]);
  });
});

describe('notifyHouseholdSync helper', () => {
  it('resolves to true and invokes stub fetch when HOUSEHOLD_SYNC is bound', async () => {
    const mockStub = {
      fetch: vi.fn().mockResolvedValue(new Response('OK')),
    };
    const env = {
      HOUSEHOLD_SYNC: {
        idFromName: vi.fn().mockReturnValue('id-123'),
        get: vi.fn().mockReturnValue(mockStub),
      },
    };

    const result = await notifyHouseholdSync(env, 'h1', { type: 'item.created', householdId: 'h1' });
    expect(result).toBe(true);
    expect(env.HOUSEHOLD_SYNC.idFromName).toHaveBeenCalledWith('h1');
    expect(mockStub.fetch).toHaveBeenCalledTimes(1);
    expect(mockStub.fetch.mock.calls[0][0]).toBe('http://durable/notify');
  });

  it('resolves safely to false without throwing when HOUSEHOLD_SYNC is undefined (degraded mode)', async () => {
    const result = await notifyHouseholdSync({}, 'h1', { type: 'item.created', householdId: 'h1' });
    expect(result).toBe(false);
  });

  it('resolves safely to false when stub fetch throws an error', async () => {
    const env = {
      HOUSEHOLD_SYNC: {
        idFromName: () => 'id-123',
        get: () => ({ fetch: () => Promise.reject(new Error('DO offline')) }),
      },
    };
    const result = await notifyHouseholdSync(env, 'h1', { type: 'item.created', householdId: 'h1' });
    expect(result).toBe(false);
  });
});
