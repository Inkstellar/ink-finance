# Ink Finance

Personal finance manager for tracking home finances, personal investments, and loans.

## Features

- **Dashboard** — Net worth overview, monthly income/expense summary, recent transactions
- **Accounts** — View and manage the accounts behind the net-worth figure; add, edit, archive and restore
- **Transactions** — Record income, expenses, transfers, investment buys/sells, loan payments
- **Investments** — Track stocks, mutual funds, ETFs, bonds, crypto, gold holdings with P&L
- **Loans** — Track active loans (home, car, personal), record EMI payments, view amortization
- **Budget** — Set monthly budgets per category, track spending progress
- **Telegram Bot** — Send a photo of any bill/receipt/UPI screenshot to @inkfin_bot; AI vision extracts merchant, amount, date, and category, then you confirm with one tap

## Tech Stack

- **Frontend:** React 18 + TypeScript + MUI (Material UI) + Vite
- **Backend:** Express.js API server with Prisma ORM
- **Database:** PostgreSQL (Neon) — dedicated `ink_finance` database
- **Telegram Bot:** Telegraf + AI vision (OpenAI-compatible API, agnes-2.5-flash with fallback chain)
- **Charts:** Recharts (ready for integration)

## Money & time (India)

This app is **single-currency and single-timezone** by design: INR and IST
(`Asia/Kolkata`). No FX, no per-user timezone.

- **Currency** — `fin_accounts.currency` and `fin_investments.currency` both
  default to `"INR"` in `prisma/schema.prisma`, the API falls back to `INR`, and
  everything renders through `formatINR` (`en-IN` locale, ₹2,88,806 style
  grouping). The bot formats with `toLocaleString('en-IN')`.
- **Timezone** — never derive today's date from `new Date().toISOString()`.
  That is UTC, so between **00:00 and 05:29 IST it returns yesterday** — a
  receipt scanned at 1 am was being filed under the previous day. Use
  `todayIST()` from `src/lib/format.ts` (or `telegram-bot/dates.ts`).
- **Display** — `formatDate` pins `timeZone: 'Asia/Kolkata'`. Dates are *stored*
  as UTC midnight of the intended calendar day, so an unpinned formatter shows
  the previous day on any device west of Greenwich.
- **Month buckets** — `GET /api/dashboard` resolves "this month" in IST. Render
  runs in UTC, and on the 1st before 05:30 IST the two disagree, which used to
  report the previous month's income and expenses.
- **Env** — `TZ=Asia/Kolkata` is set in `.env*` and `render.yaml` so any new
  local-time code is IST by default. Correctness no longer *depends* on it (the
  date helpers specify the timezone explicitly), but keep it consistent.

## Database

Uses a dedicated `ink_finance` database on the same Neon PostgreSQL project as `puck-nextjs-starter`. This is a separate database, so `prisma db push` is safe — it won't affect the puck project's tables.

Tables (all prefixed with `fin_`):

- `fin_accounts` — Bank accounts, cash, credit cards, investment accounts
- `fin_categories` — Income/expense/transfer categories with hierarchical parent support
- `fin_transactions` — All financial transactions
- `fin_budgets` — Monthly budget per category
- `fin_investments` — Investment holdings (stocks, MFs, ETFs, etc.)
- `fin_loans` — Loan accounts with principal, interest, EMI tracking
- `fin_loan_payments` — EMI payment history with principal/interest breakdown

## Quick Start

```bash
cd ink-finance
npm install
npm run db:generate    # Generate Prisma client
npm run db:push         # Create tables in the database
npm run dev             # Start both API server (3456) and Vite dev server (5179)
```

Open http://localhost:5179

## Authentication

The whole app sits behind a login. Auth.js (`@auth/express`) guards the **API** —
that is the real boundary — and the SPA renders a login screen in front of it.

**Managing logins from the UI:** the **Users** page has an *Email (for login)*
field and a key icon per row to set or change a password, so you rarely need the
terminal. Setting your **own** password there asks for the current one; setting
someone else's does not (it's a two-person household app, and there'd otherwise
be no way to give the second person a first password). A user with an email but
no password shows "no password set — cannot sign in".

```bash
# From the terminal instead:
npm run user:set-password                       # interactive, lists users to pick
npm run user:set-password -- --user K           # attach a login to user K
npm run user:set-password --user K              # also works

# Verify the whole flow end-to-end against a running API
npm run test:auth
```

> **Why the `--` matters:** npm treats unknown `--flags` as *its own* config and
> forwards only the bare value, so `npm run user:set-password --user K` really
> runs `… K`. The script treats a non-email argument as the user selector, which
> is why that form still works — but `--` is the correct spelling.

Design notes worth knowing before changing anything here:

- **Every `/api` route requires a session** except `/api/health` (the keepalive
  Action pings it) and `/api/auth/*` (you must be able to sign in). A user row
  with no `passwordHash` simply cannot sign in.
- **The browser always calls a relative `/api`.** Locally Vite proxies it
  (`VITE_API_PROXY_TARGET`), in production a Render rewrite on the static site
  proxies `/api/*` to the API service. This is not cosmetic: `onrender.com` is on
  the **Public Suffix List**, so `…-web.onrender.com` and `…-api.onrender.com` are
  *different sites* to the browser. Calling the API directly would make the
  session cookie a third-party cookie, which Safari drops outright. Same-origin
  also means CORS is no longer needed for normal traffic.
- **Sessions are JWTs**, which is mandatory for the Credentials provider.
  Signing out clears the cookie, but the token stays valid until it expires, so
  it cannot be revoked server-side — keep `AUTH_SECRET` secret and rotate it to
  invalidate everything.
- **The Telegram bot is not affected**: it authenticates server-to-server with
  `SERVICE_TOKEN` via the `X-Service-Token` header (set the same value on the api
  and bot services).

## Develop against the deployed services

You don't have to run the API server locally. The Render deployment can serve
your local UI instead, so you edit the frontend against **real data** while the
deployed Telegram bot keeps feeding the same database.

```bash
npm run render:status          # wake the free-tier services + check they're up
npm run dev:use-render-server  # Vite dev server only, pointed at the Render API
```

Open http://localhost:5179. Nothing is proxied — the browser calls
`https://ink-finance-api.onrender.com` directly (the API has CORS enabled).

| Command | Runs locally | API it talks to |
|---------|--------------|-----------------|
| `npm run dev` | API + web | local (`localhost:3456`) |
| `npm run dev:all` | API + web + bot | local |
| `npm run dev:use-render-server` | web only | **Render API** |
| `npm run dev:use-render-server:with-bot` | web + bot | **Render API** |
| `npm run render:status` | nothing | pings all three Render services |

How it's wired:

- **`.env.render`** — the profile: the three deployed URLs, no secrets, committed.
- **`scripts/run-with-env.mjs`** — loads env files left-to-right, **last wins**,
  so `.env.local` (secrets) sits underneath `.env.render` (URLs).
- **`vite --mode render`** — Vite loads `.env.render` after `.env.local`, so its
  `VITE_API_URL` overrides the localhost one.

Gotchas:

- **Free-tier cold starts.** The API and bot web services sleep after ~15 min
  with no traffic; the first request can take 30–60s. Run `npm run render:status`
  first so the browser doesn't eat that delay.
- **Don't run the bot locally while the Render bot is up.** Telegram allows only
  one `getUpdates` poller per token — a second one gets `409 Conflict` and both
  instances start erroring. `dev:use-render-server` therefore starts the **web
  only** and lets Render's bot handle Telegram. Use `...:with-bot` only when you
  are debugging the bot itself, and suspend the Render bot first.
- **Writes are real.** The Render API uses the real Neon `ink_finance` database,
  so anything you add in local dev lands in your actual data.
- `strictPort: true` means port 5179 must be free.

## Telegram Bot

Send a photo of any bill, receipt, or UPI payment screenshot (PhonePe / GPay / Paytm) to **@inkfin_bot** in Telegram. The AI vision model extracts merchant, amount, date, and category, shows a confirmation card, and you tap an account button to record the transaction.

Setup in `.env.local`:

```bash
BOT_TOKEN=<token from @BotFather>
BOT_ALLOWED_USERS=            # comma-separated Telegram IDs (empty = anyone)
AI_API_KEY=sk-...             # OpenAI-compatible API key
AI_BASE_URL=https://router.bynara.id/v1
AI_MODEL=agnes-2.5-flash      # falls back to ling-3.0-flash-vl-free / agnes-2.5-flash
```

```bash
npm run bot        # start the Telegram bot (long polling)
npm run dev:all    # start API + web + bot together
```

Bot commands: `/setup` (create default categories + Cash account), `/balance`, `/categories`, `/help`

You can also type quick manual entries: `spent 500 groceries at Reliance` or `received 50000 salary`.

## API Server

The Express API server runs on port 3456 with these endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dashboard` | Aggregate summary: net worth, monthly totals |
| GET/POST | `/api/accounts` | List / create accounts |
| PUT/DELETE | `/api/accounts/:id` | Update / archive accounts |
| GET/POST | `/api/categories` | List / create categories |
| GET/POST | `/api/transactions` | List / create transactions |
| DELETE | `/api/transactions/:id` | Delete transaction |
| GET/POST | `/api/budgets` | List / set budgets |
| GET/POST | `/api/investments` | List / add holdings |
| PUT/DELETE | `/api/investments/:id` | Update / delete holding |
| GET/POST | `/api/loans` | List / create loans |
| POST | `/api/loans/:id/payment` | Record loan EMI payment |
| PUT | `/api/loans/:id` | Update loan status |

## Project Structure

```
ink-finance/
├── prisma/
│   └── schema.prisma       # Database models (fin_* tables)
├── server/
│   └── index.ts             # Express API server
├── telegram-bot/            # Telegram bot service
│   ├── index.ts             # Bot logic, inline keyboards, handlers
│   ├── ai-vision.ts         # AI vision receipt analysis (+ model fallback)
│   ├── api-client.ts        # ink-finance REST API client
│   └── types.ts             # Shared types
├── src/
│   ├── components/          # Shared UI components
│   │   ├── Sidebar.tsx
│   │   └── StatCard.tsx
│   ├── hooks/
│   │   └── useApi.ts        # Data fetching hook
│   ├── lib/
│   │   ├── api.ts           # API client
│   │   └── format.ts        # INR formatting helpers
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── Transactions.tsx
│   │   ├── Investments.tsx
│   │   ├── Loans.tsx
│   │   └── Budget.tsx
│   ├── App.tsx              # Router + layout
│   ├── main.tsx             # Entry point
│   └── theme.ts             # MUI theme
├── scripts/
│   ├── run-with-env.mjs     # run a command with layered .env files
│   └── render-status.mjs    # ping the deployed Render services
├── .env.local               # Secrets + local URLs (gitignored)
├── .env.render              # Render profile: deployed URLs only (committed)
├── .gitignore
├── package.json
├── vite.config.ts
└── tsconfig.json
```
