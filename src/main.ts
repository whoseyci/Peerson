import { App } from './app';
import { api } from './api/client';
import { openBarcodeScanner } from './scanner';

const app = new App();
(window as any).app = app;
(window as any).api = api;
(window as any).openBarcodeScanner = openBarcodeScanner;
app.init();

// Best-effort service worker registration for Web Push (Issue #48).
// Not required for the app to work — if the browser doesn't support SW,
// or the user is on http (not https + not localhost), this silently
// no-ops. The Push toggle in the household view feature-detects again
// before attempting to subscribe.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.info('Service worker registration skipped:', err?.message || err);
    });
  });
}
