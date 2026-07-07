// Peerson service worker.
//
// Scope of this file today (Issue #48):
//   - Register a passthrough fetch handler so the service worker is
//     valid & installable (required before any browser will let a page
//     call `PushManager.subscribe()`). We do NOT try to cache assets
//     here — a proper offline strategy is a separate concern.
//   - Handle incoming `push` events by displaying an OS notification.
//   - Handle `notificationclick` events by focusing an existing tab
//     (or opening a new one) at the URL carried in the payload.
//
// Payload shape (matches what functions/api/_pushNotify.ts sends):
//   { title, body, url, tag }

self.addEventListener('install', (event) => {
  // Activate the new SW immediately on install so a returning user with
  // an old SW registration doesn't have to wait for all tabs to close
  // before push starts working.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Passthrough. Present so the SW registration is "controlling"; not
// intercepting any requests today.
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    // Non-JSON payload (or empty). Fall back to a generic notification.
    payload = { title: 'Peerson', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Peerson';
  const options = {
    body: payload.body || '',
    icon: '/manifest-icon.png',
    badge: '/manifest-icon.png',
    tag: payload.tag || 'peerson',
    // Roll up rapid-fire notifications with the same tag into one banner
    // instead of spamming the user.
    renotify: false,
    data: { url: payload.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Prefer focusing an already-open Peerson tab; navigate it to the
    // deep link if it isn't already there.
    for (const client of allClients) {
      try {
        const url = new URL(client.url);
        if (url.origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client && url.pathname + url.search !== new URL(targetUrl, self.location.origin).pathname) {
            try { await client.navigate(targetUrl); } catch (_) { /* Safari/older */ }
          }
          return;
        }
      } catch (_) { /* ignore malformed client URLs */ }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
