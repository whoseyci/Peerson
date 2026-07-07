self.addEventListener('push', function(event) {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Peerson Notification', body: event.data.text() };
    }
  }

  const title = data.title || 'Peerson';
  const options = {
    body: data.body || '',
    icon: '/manifest.json',
    badge: '/manifest.json',
    tag: data.tag || 'peerson-notification',
    data: {
      url: data.url || '/',
      view: data.view || 'home',
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const targetView = event.notification.data?.view || 'home';
  const targetUrl = event.notification.data?.url || '/?view=' + targetView;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url && 'focus' in client) {
          client.focus();
          client.postMessage({ type: 'NAVIGATE_VIEW', view: targetView, url: targetUrl });
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
