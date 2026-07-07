# Playwright smoke tests

These are optional end-to-end UI checks that are **not** part of the
default `npm test` run (which stays vitest-only, so CI doesn't have to
download a headless Chromium binary on every push).

They spin up a tiny in-process Node HTTP server that serves the Vite
build output plus stub `/api/*` responses, then drive Playwright against
that so the automated tests don't need Cloudflare Pages Functions or
D1 to be running.

## Run them locally

```bash
npm run build
npx --yes playwright@1.61.1 install chromium   # first time only
node test-playwright/smoke.cjs
```

Screenshots land in `test-playwright/shots/` (git-ignored).

## What they cover today

`smoke.cjs` — verifies the **Push notifications** UI landing in the
household view (Issue #48) reacts correctly to `/api/push-config`:

- Server *not* configured (`{ configured: false }`) → toggle disabled,
  labeled "Nicht konfiguriert" with a clear explanation.
- Server *configured* → toggle enabled, labeled
  "Benachrichtigungen aktivieren" ready for the user to tap.

If you're adding a new UI concern that's easier to verify end-to-end
than as a unit test, add a scenario here rather than pulling Playwright
into the main test suite.
