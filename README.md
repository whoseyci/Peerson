# Peerson

A wholesome app for shared households. Track your pantry, split expenses, assign tasks, and manage a smart shopping list — together.

## Features

- **Households** — Create a household and invite others via a shareable link or 8-digit code.
- **Live Sync** — Changes made by other household members (new tasks, shopping items, expenses...) show up automatically within a few seconds, no manual reload needed. Never interrupts you mid-edit — a background sync will never close a modal or clear text you're typing.
- **Undo Everything** — Deleting an item, task, shopping entry, or expense is instant but reversible: a 5-second "Rückgängig" (undo) toast appears before anything is actually removed from the server.
- **Pantry / Inventory** — Track items with quantities, locations, expiry dates (MHD), and barcodes. Edit an item's name, category, threshold, and expiry per batch any time.
- **Nested Storage Locations** — Model where things actually live: rooms → furniture/containers → shelf positions (e.g. Küche → Rollcontainer → oben), managed in Settings (add/rename/delete, arbitrary depth). Assign or move an item between locations from its detail view; deleting a location un-assigns (never deletes) the items inside it.
- **Multi-Barcode Items** — Link several barcodes to one item (e.g. different pack sizes), each with its own gram weight. Scanning any linked barcode recognizes the item; adding stock shows a variant picker when more than one barcode is linked.
- **Nutrition Info** — Per-100g nutrition (energy, fat, carbs, protein) auto-filled from Open Food Facts when scanning, or entered manually for items without a barcode.
- **Price Tracking & Inflation History** — Record a price per item. Only price *changes* are kept in history (not one entry per purchase), so you can see exactly how much and when a price moved — no clutter from repeat purchases at the same price.
- **Barcode Scanner** — Scan a product with your camera to look it up (via [Open Food Facts](https://world.openfoodfacts.org)) and auto-fill its name, category and photo. Scanning a barcode already in your pantry jumps straight to "add stock" instead of creating a duplicate. Runs a background rescue pass for real-world blurry/low-contrast barcode photos that the primary decoder can't read on its own.
- **Smart Shopping List** — Manually add items, scan a barcode, or let the app auto-suggest low-stock pantry items. Scanning something into the pantry automatically checks it off the shopping list if it was on there.
- **Task Assignment** — Create tasks, assign them to household members, set due dates.
- **Fairness Tracking** — A running log of who actually completes tasks over time, surfaced as a "this week" summary and per-person stats — purely informational, doesn't change how tasks are assigned or rotated.
- **Move Stock Between Rooms** — Assign a batch to a specific room/container independent of its item's default location, and move a quantity between locations with one tap — moves are FIFO-aware and split a batch if needed so expiry dates are never lost.
- **Receipt Scanning** *(optional, requires a Gemini API key)* — Photograph a paper receipt to auto-extract its line items for review before adding them to your shopping list.
- **Expense & Income Splitting** — Log who paid what and split costs equally among members. Balances are calculated automatically.
- **Monochrome Design** — Clean, accessible UI with dark mode support.

## Tech Stack

- **Frontend:** Vanilla TypeScript + Vite (SPA, PWA-ready)
- **Backend:** Cloudflare Pages Functions (Workers)
- **Database:** Cloudflare D1 (SQLite)
- **Deploy:** GitHub Actions → Cloudflare Pages

## Setup

### 1. Prerequisites

- Node.js 20+
- A Cloudflare account
- `wrangler` CLI installed globally: `npm install -g wrangler`

### 2. Create D1 Database

```bash
wrangler d1 create peerson-db
```

Copy the `database_id` from the output and paste it into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "peerson-db"
database_id = "your-database-id-here"
```

### 3. Initialize Schema

```bash
wrangler d1 execute peerson-db --file=./schema.sql
```

If you already had a Peerson database running before nested storage
locations / item pricing existed, `schema.sql` alone won't retroactively
add the new bits (`CREATE TABLE IF NOT EXISTS` skips tables that already
exist, and it can't add columns to an existing `items` table). Run the
one-off migration once instead:

```bash
wrangler d1 execute peerson-db --file=./migrations/001_locations_and_pricing.sql
```

If your database predates per-batch locations (moving part of an item's
stock between rooms) and the task-completion/fairness log, run this one
too (safe to run in addition to, or instead of, `001` above — each
migration only touches the columns/tables it's responsible for and is a
no-op if already applied, except the `ALTER TABLE ADD COLUMN` lines,
which error if re-run — see that file's own comments):

```bash
wrangler d1 execute peerson-db --file=./migrations/002_batch_locations_and_task_completions.sql
```

Fresh setups only need `schema.sql` and should skip both migration files.

### 4. Local Development

```bash
npm install
npm run dev
```

For full local dev with Functions + D1:

```bash
npx wrangler pages dev dist --d1=DB
```

### 5. Deploy to Cloudflare Pages

#### Option A: GitHub Actions (Auto-deploy)

1. Push this repo to GitHub.
2. In your Cloudflare dashboard, create a Pages project and connect it to this repo.
3. Set these secrets in your GitHub repo (`Settings → Secrets and variables → Actions`):
   - `CLOUDFLARE_API_TOKEN` — Create one at https://dash.cloudflare.com/profile/api-tokens with "Cloudflare Pages:Edit" and "Account:Read" permissions.
   - `CLOUDFLARE_ACCOUNT_ID` — Found on the right sidebar of your Cloudflare dashboard.
4. Every push to `main` will auto-deploy.

#### Option B: Manual Deploy

```bash
npm run build
wrangler pages deploy dist --project-name=peerson
```

### 6. Bind D1 to Pages Project

After the first deploy, go to your Cloudflare Pages project settings:
- **Settings → Functions → D1 database bindings**
- Add a binding named `DB` pointing to your `peerson-db` database.
- Redeploy if needed.

### 7. (Optional) In-app bug reporting

The "🐛" button lets users file a bug report without leaving the app or
needing a GitHub account — it's handled entirely server-side by
`functions/api/bug-report.ts`. To enable it:

1. Create a **fine-grained GitHub Personal Access Token** scoped only to
   this repo, with **Issues: Read & write** and **Contents: Read & write**
   permissions (Contents is only needed so screenshots can be committed
   into `bug-reports/` and rendered inline — GitHub strips `data:` URI
   images from issue bodies, so a raw committed file is the only way to
   get an inline screenshot to actually show up).
2. In your Cloudflare Pages project: **Settings → Environment variables**,
   add `GITHUB_PAT` as an **encrypted/secret** variable (for both
   Production and Preview environments) with that token as its value.
3. (Optional) If you forked this repo, also set `GITHUB_REPO` to
   `your-username/your-repo` — it defaults to `whoseyci/Peerson`.
4. Redeploy. If `GITHUB_PAT` isn't set, the bug button still works — it
   falls back to opening a pre-filled GitHub "new issue" page in a new
   tab instead of submitting automatically.

**Never** put this token in `wrangler.toml`, a `[vars]` block, or any
client-side code — those are all bundled/committed in plaintext. It must
only ever live as an encrypted Pages environment variable, read
server-side inside a Function.

### 8. (Optional) Receipt scanning

The capture menu's "Beleg scannen" option lets you photograph a paper
receipt and have its line items extracted automatically, handled
server-side by `functions/api/receipt-scan.ts` via Google's Gemini vision
API. To enable it:

1. Create a free API key at
   [Google AI Studio](https://aistudio.google.com/apikey).
2. In your Cloudflare Pages project: **Settings → Environment variables**,
   add `GEMINI_API_KEY` as an **encrypted/secret** variable (for both
   Production and Preview environments) with that key as its value.
3. Redeploy. If `GEMINI_API_KEY` isn't set, the feature still opens and
   explains itself instead of failing silently — it shows a "not set up
   yet" message pointing back to these steps rather than erroring.

**Never** put this key in `wrangler.toml`, a `[vars]` block, or any
client-side code, for the same reason as `GITHUB_PAT` above — it must
only ever live as an encrypted Pages environment variable.

### 9. Barcode scanning & product lookup

No setup required — `functions/api/product-lookup.ts` proxies to
[Open Food Facts](https://world.openfoodfacts.org), a free, keyless,
community-maintained product database, and caches results at Cloudflare's
edge for 24h. The camera scanner uses the
[html5-qrcode](https://github.com/mebjas/html5-qrcode) library (loaded via
CDN in `index.html`) and requires HTTPS (or `localhost`) to access the
camera — this is a browser requirement, not something Peerson controls.
If camera access is denied or unavailable, users can type the barcode in
manually; the rest of the flow (lookup, prefill, add-stock shortcut) works
identically either way.

## Project Structure

```
peerson/
├── .github/workflows/deploy.yml   # Auto-deploy pipeline
├── functions/                     # Cloudflare Pages Functions API
│   ├── api/
│   │   ├── households.ts         # Create, join, invite
│   │   ├── items.ts              # Pantry items
│   │   ├── batches.ts            # Stock batches / quantities
│   │   ├── tasks.ts              # Task management
│   │   ├── expenses.ts           # Expenses & splits
│   │   └── shopping.ts           # Shopping list
│   └── _middleware.ts            # CORS
├── src/
│   ├── main.ts                   # Entry point
│   ├── app.ts                    # App state, router, modals
│   ├── api/client.ts             # API client
│   ├── views/                    # Page views
│   └── styles/main.css           # Design system
├── index.html
├── schema.sql                     # D1 database schema
├── package.json
├── vite.config.ts
└── wrangler.toml
```

## Usage

1. Open the app and enter your name.
2. Create a household or join one via invite code/link.
3. Use the bottom dock to switch between:
   - **Vorrat** — Manage pantry items and stock.
   - **Einkaufen** — Shopping list with auto-suggestions for low stock.
   - **Aufgaben** — Assign and track household tasks.
   - **Finanzen** — Split expenses and see who owes what.
   - **Haushalt** — Invite members, copy invite link, toggle dark mode.

## Notes

- No passwords or complex auth — just your name and household membership.
- All data is stored in Cloudflare D1 and synced across devices in real-time.
- The app works great as a mobile PWA. Add it to your home screen!

## License

MIT
