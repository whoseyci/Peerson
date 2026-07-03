# Peerson

A wholesome app for shared households. Track your pantry, split expenses, assign tasks, and manage a smart shopping list — together.

## Features

- **Households** — Create a household and invite others via a shareable link or 8-digit code.
- **Pantry / Inventory** — Track items with quantities, locations, expiry dates (MHD), and barcodes.
- **Smart Shopping List** — Manually add items or let the app auto-suggest low-stock pantry items.
- **Task Assignment** — Create tasks, assign them to household members, set due dates.
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
