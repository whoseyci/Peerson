import { api } from '../api/client';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function checkPushSupport(): Promise<boolean> {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getPushSubscriptionState(): Promise<{ supported: boolean; configured: boolean; subscribed: boolean; permission: NotificationPermission }> {
  const supported = await checkPushSupport();
  if (!supported) {
    return { supported: false, configured: false, subscribed: false, permission: 'denied' };
  }

  const permission = Notification.permission;
  let configured = false;
  let subscribed = false;

  try {
    const app = (window as any).app;
    if (app?.state?.householdId) {
      const serverConfig = await (app.api?.push?.getConfig(app.state.householdId) || api.push.getConfig(app.state.householdId));
      configured = Boolean(serverConfig?.configured);

      const reg = await navigator.serviceWorker.getRegistration('/sw.js') || await navigator.serviceWorker.getRegistration();
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub && serverConfig?.subscriptions?.includes(sub.endpoint)) {
          subscribed = true;
        }
      }
    }
  } catch (e) {
    console.error('getPushSubscriptionState error:', e);
  }

  return { supported, configured, subscribed, permission };
}

export async function subscribeToPush(householdId: string): Promise<{ success: boolean; error?: string }> {
  const supported = await checkPushSupport();
  if (!supported) return { success: false, error: 'Push-Benachrichtigungen werden von diesem Browser nicht unterstützt.' };

  try {
    const app = (window as any).app;
    const serverConfig = await (app?.api?.push?.getConfig(householdId) || api.push.getConfig(householdId));
    if (!serverConfig?.configured || !serverConfig?.vapidPublicKey) {
      return { success: false, error: 'Push-Benachrichtigungen sind auf dem Server nicht konfiguriert (VAPID-Schlüssel fehlen).' };
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { success: false, error: 'Berechtigung für Benachrichtigungen verweigert.' };
    }

    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const applicationServerKey = urlBase64ToUint8Array(serverConfig.vapidPublicKey);
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as any,
      });
    }

    const subJson = sub.toJSON();
    if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
      return { success: false, error: 'Ungültiges Abonnement generiert.' };
    }

    await (app?.api?.push?.subscribe({
      household_id: householdId,
      endpoint: subJson.endpoint,
      keys: {
        p256dh: subJson.keys.p256dh,
        auth: subJson.keys.auth,
      },
    }) || api.push.subscribe({
      household_id: householdId,
      endpoint: subJson.endpoint,
      keys: {
        p256dh: subJson.keys.p256dh,
        auth: subJson.keys.auth,
      },
    }));

    return { success: true };
  } catch (e: any) {
    console.error('subscribeToPush error:', e);
    return { success: false, error: e?.message || 'Fehler beim Abonnieren.' };
  }
}

export async function unsubscribeFromPush(): Promise<{ success: boolean; error?: string }> {
  const supported = await checkPushSupport();
  if (!supported) return { success: true };

  try {
    const app = (window as any).app;
    const reg = await navigator.serviceWorker.getRegistration('/sw.js') || await navigator.serviceWorker.getRegistration();
    if (reg) {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        try {
          await (app?.api?.push?.unsubscribe(sub.endpoint) || api.push.unsubscribe(sub.endpoint));
        } catch (e) {}
        await sub.unsubscribe();
      }
    }
    return { success: true };
  } catch (e: any) {
    console.error('unsubscribeFromPush error:', e);
    return { success: false, error: e?.message || 'Fehler beim Abbestellen.' };
  }
}
