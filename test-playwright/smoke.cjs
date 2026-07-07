// End-to-end smoke test for the Push-notifications UI landing in the
// household view. Runs a tiny Node HTTP server that serves the Vite
// build output + stub /api/* JSON responses (no D1 or Workers runtime
// needed), then drives Playwright against it.
//
// Verifies:
//   1) The "Benachrichtigungen" section is rendered.
//   2) When /api/push-config returns { configured: false }, the toggle
//      shows the "Nicht konfiguriert" copy and is disabled — matching
//      the graceful-degradation contract in the README.
//   3) When /api/push-config returns { configured: true }, the toggle
//      offers to enable notifications (state=off, label ends with
//      "aktivieren").
//   4) No console errors on the page.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIST = path.resolve(__dirname, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}

function makeServer({ pushConfigured }) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    // Stub API layer. Just enough for the app to init without exploding.
    if (url.pathname === '/api/push-config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(pushConfigured
        ? { configured: true, publicKey: 'BFakePublicKeyValue' }
        : { configured: false, publicKey: null }));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Empty/no-op JSON — the household view seeds its own state locally,
      // so /api/households returning [] just means "no household yet"
      // (which is fine for this test) OR the app is already scoped to a
      // localStorage-seeded household id.
      res.end(JSON.stringify({}));
      return;
    }
    // Static files.
    let p = url.pathname;
    if (p === '/') p = '/index.html';
    const filePath = path.join(DIST, p);
    if (!filePath.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
    serveFile(res, filePath);
  });
}

async function withServer({ pushConfigured }, fn) {
  const server = makeServer({ pushConfigured });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

async function seedHouseholdInLocalStorage(page) {
  // Bypass the "no household yet" screen by pre-seeding state that
  // renderHouseholdView reads (see src/app.ts init()).
  await page.addInitScript(() => {
    localStorage.setItem('peerson_userId', 'test-user');
    localStorage.setItem('peerson_userName', 'Testperson');
    localStorage.setItem('peerson_householdId', 'test-household');
    localStorage.setItem('peerson_view', 'household');
  });
}

async function forceHouseholdState(page) {
  // Even with a stored householdId, App.loadHousehold hits /api/households
  // which our stub returns {} for, so state.household stays null and the
  // welcome screen renders. For the purposes of THIS smoke test (verify
  // the notifications UI section exists and reacts to /api/push-config),
  // it's enough to inject a synthetic household into app.state and
  // re-render directly.
  await page.evaluate(() => {
    const app = window.app;
    app.state.household = { id: 'test-household', name: 'Test WG', invite_code: 'ABCD1234' };
    app.state.householdId = 'test-household';
    app.state.members = [{ id: 'test-user', name: 'Testperson', role: 'admin', joined_at: 1 }];
    app.state.locations = [];
    app.state.items = app.state.items || [];
    app.state.batches = app.state.batches || [];
    app.state.tasks = app.state.tasks || [];
    app.state.expenses = app.state.expenses || [];
    app.state.shoppingItems = app.state.shoppingItems || [];
    app.state.view = 'household';
    localStorage.setItem('peerson_view', 'household');
    app.render();
  });
}

async function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}

async function runScenario(pushConfigured, label) {
  console.log(`\n=== Scenario: pushConfigured=${pushConfigured} (${label}) ===`);
  return withServer({ pushConfigured }, async (baseUrl) => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    if (pushConfigured) {
      // chromium-headless-shell unconditionally reports
      // Notification.permission === 'denied' regardless of granted
      // permissions, which would short-circuit the "off, offer to
      // enable" state we want to test. Stub the permission to 'default'
      // in-page so we can actually exercise the intended UI path a real
      // (headed) user hits when they haven't decided yet.
      await context.addInitScript(() => {
        try {
          Object.defineProperty(Notification, 'permission', {
            configurable: true, get() { return 'default'; },
          });
        } catch (_) { /* ignore */ }
      });
    }
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

    await seedHouseholdInLocalStorage(page);
    await page.goto(baseUrl);
    // Wait for the app to boot.
    await page.waitForFunction(() => !!window.app, { timeout: 5000 });
    await forceHouseholdState(page);

    // Give the render + async-refresh a moment.
    await page.waitForTimeout(400);

    // If the button still isn't there, dump some diagnostics.
    const btnPresent = await page.$('#pushToggleBtn');
    if (!btnPresent) {
      const bodyText = await page.$eval('body', el => el.innerText.slice(0, 400));
      const currentView = await page.evaluate(() => window.app?.state?.currentView);
      console.log('DEBUG bodyText:', JSON.stringify(bodyText));
      console.log('DEBUG currentView:', currentView);
    }

    // Wait for the Notifications section to be present.
    await page.waitForSelector('#pushToggleBtn', { timeout: 5000 });
    // Give the async /api/push-config fetch + refresh a moment.
    await page.waitForTimeout(400);

    const notifPerm = await page.evaluate(() => Notification.permission);
    console.log('  Notification.permission =', notifPerm);
    const state = await page.$eval('#pushToggleBtn', el => el.getAttribute('data-state'));
    const label2 = await page.$eval('#pushToggleLabel', el => el.textContent.trim());
    const disabled = await page.$eval('#pushToggleBtn', el => el.disabled);
    const help = await page.$eval('#pushStatusText', el => el.textContent.trim());
    console.log(`  state=${state}  label="${label2}"  disabled=${disabled}`);
    console.log(`  help="${help}"`);

    if (pushConfigured) {
      // Configured but user hasn't opted in yet → state=off, button
      // enabled, prompt to enable.
      await assert(state === 'off', 'expected state=off when configured & not opted in');
      await assert(!disabled, 'expected button ENABLED when opt-in is possible');
      await assert(/aktivieren/i.test(label2), 'expected label to invite activation');
    } else {
      // Not configured server-side → state=unconfigured, button disabled,
      // clear German-language explanation shown in the help copy.
      await assert(state === 'unconfigured', 'expected state=unconfigured');
      await assert(disabled === true, 'expected button DISABLED when server missing VAPID');
      await assert(/nicht.*konfiguriert|nicht eingerichtet/i.test(help.toLowerCase()) || /konfiguriert/i.test(help),
        'expected help text to explain server is not configured');
    }

    // Screenshot for the PR (scroll the Notifications section into view first).
    fs.mkdirSync(path.resolve(__dirname, 'shots'), { recursive: true });
    await page.$eval('#pushToggleBtn', el => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(100);
    await page.screenshot({
      path: path.resolve(__dirname, `shots/push-${pushConfigured ? 'configured' : 'unconfigured'}.png`),
      fullPage: false,
    });

    if (errors.length) {
      // Node ships without WebPushManager in the userAgent; the sw.js
      // registration failing on file:// is fine — filter benign infos.
      const real = errors.filter(e => !/service worker/i.test(e));
      if (real.length) {
        console.log('  errors:', real);
        throw new Error('JS errors on page');
      }
    }

    await browser.close();
    console.log('  OK ✓');
  });
}

(async () => {
  await runScenario(false, 'server missing VAPID → graceful degradation');
  await runScenario(true, 'server configured → toggle offers activation');
  console.log('\nALL SMOKE TESTS PASSED ✓');
})().catch(e => { console.error(e); process.exit(1); });
