export interface RealtimeNotifyEnv {
  REALTIME_NOTIFY_URL?: string;
  REALTIME_NOTIFY_SECRET?: string;
}

export interface RealtimeNotifyEvent {
  householdId: string;
  resource: string;
  action: string;
  actorUserId?: string | null;
  excludeClientId?: string | null;
}

export async function notifyHouseholdChanged(env: RealtimeNotifyEnv, event: RealtimeNotifyEvent) {
  if (!env.REALTIME_NOTIFY_URL || !env.REALTIME_NOTIFY_SECRET || !event.householdId) return;
  try {
    await fetch(env.REALTIME_NOTIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.REALTIME_NOTIFY_SECRET}`,
      },
      body: JSON.stringify({ ...event, eventId: crypto.randomUUID() }),
    });
  } catch (e) {
    console.warn('Realtime notify failed', e);
  }
}
