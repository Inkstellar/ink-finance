# Ink Finance

Personal finance manager for tracking home finances, personal investments, and loans.

## Features

- **Dashboard** — Net worth overview, monthly income/expense summary, recent transactions
- **Accounts** — View and manage the accounts behind the net-worth figure; add, edit, archive and restore
- **Transactions** — Record income, expenses, transfers, investment buys/sells, loan payments
- **Investments** — Track stocks, mutual funds, ETFs, bonds, crypto, gold holdings with P&L
- **Loans** — Track active loans (home, car, personal), record EMI payments, view amortization; edit any loan's terms, change its status, remove a mis-entered payment, or delete it
- **Budget** — Set monthly budgets per category, track spending progress
- **Users** — Manage household members, their logins and profile pictures
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
npm run test:avatar  # profile pictures: upload, serve, ETag, every rejection
npm run test:loans
npm run test:tx
npm run test:privacy # no endpoint leaks a password hash or an avatar
npm run test:alerts  # transaction alerts: who is messaged, and who is not
npm run test:bot     # pure analytics: templates, bucketing, reports
npm run test:notify  # pure: alert wording, escaping, recipient selection
```

> **Why the `--` matters:** npm treats unknown `--flags` as *its own* config and
> forwards only the bare value, so `npm run user:set-password --user K` really
> runs `… K`. The script treats a non-email argument as the user selector, which
> is why that form still works — but `--` is the correct spelling.

**Profile pictures:** on the Users page, open a user and use **Upload photo**
(gallery/files) or **Take photo**, which sets `capture="user"` on the file input
so a phone opens the camera instead. The picture shows in the users table and in
the sidebar, and replaces the initials everywhere. It is saved when you hit
**Save**, so cancelling the dialog leaves the stored picture alone.

How it works, and the constraints that shaped it:

- The browser downscales to a **256px** square-ish JPEG before uploading
  (`src/lib/image.ts`) — a 33KB phone photo becomes ~9KB, which keeps the upload
  quick on mobile data. The API independently enforces its own limits; the
  client-side resize is courtesy, not the security boundary.
- Stored as base64 in `fin_users.avatar` (+ `avatarMime`), **not** a file on
  disk: Render's filesystem is ephemeral, so a runtime-written file would vanish
  on the next deploy.
- Served as image bytes from `GET /api/users/:id/avatar` with an `ETag` and
  `Cache-Control: private`, rather than embedded in JSON. `GET /api/users`
  returns `hasAvatar` instead, so listing users doesn't carry image data.
- The picture is deliberately **not** in the session JWT: an image would blow
  past the ~4KB cookie limit. The sidebar fetches `/api/users/me` and refreshes
  on an `ink:avatar-changed` event, so a new picture appears without a reload.
- Applied to the database with `prisma/add-avatar-columns.sql` — the Render build
  only runs `prisma generate`, so schema changes are applied by hand:
  `npx prisma db execute --file prisma/add-avatar-columns.sql`

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

Bot commands: `/recent`, `/week`, `/weeks`, `/trend`, `/balance`, `/loan`, `/categories`, `/setup`, `/help`

**Transaction templates** — one line each, all six types:

```
expense 500 groceries at Reliance
income 85000 salary
transfer 10000 from Cash to HDFC (Kousi)
invest 25000 in Mutual Fund
sell 15000 in Mutual Fund
loanpay 2076 for Hdfc housing
```

Add `by K` to attribute it without being asked. Amounts accept `5k`, `1.2L` and `1cr`.
A transfer moves money between both accounts, and a loan payment updates the loan's
outstanding balance as well as recording the transaction (booked as principal — use
the Loans page if you need to split interest).

**Reports** — `all users` by default, add a user (name or initials) to scope one:

```
/recent 20          latest transactions
/week               the past 7 days
/weeks 4            the last N weeks
/trend monthly      also: quarterly · half · yearly
/trend quarterly K  spending trend for one person
```

Reports show totals in and out, a by-category breakdown, then the rows themselves.

### Transaction alerts

Whenever a transaction is added, every *other* user is messaged on Telegram —
whoever entered it is left out, since being told about your own action is
noise. It works from both directions:

- entered in the **web UI** → the API alerts the others
- entered via the **bot** (receipt photo or template) → the bot tells the API
  who sent it, and the API alerts the others

The alert names the amount, description, category, account and date, the
account's new balance, and who added it, with a button back into the app:

```
💸 New expense

💰 -₹1,500.00
📝 bus ticket
🏷 Transport
💳 HDC (Kousi)
📅 20 Sep 2026

⚖️ HDC now ₹48,500.00

👤 Added by Kousi
```

Only users with a Telegram id set on the Users page receive alerts. The wording
lives in `shared/notify.ts`, imported by both the API and the bot, so the two
paths cannot drift. Alerts are sent *after* the response and never throw: a
Telegram failure cannot fail the transaction that caused it.

Set `WEB_URL` on the API service for the "Open in app" button; without it the
alert is sent without the button.

**The id must be numeric.** The Bot API cannot deliver a private message to an
`@username` — `sendMessage` answers `400 chat not found` — so a handle typed
into the Users page looks correct and silently breaks alerts. You do not have to
copy the number yourself: the numeric id is only knowable while someone is
talking to the bot, so **the first message either of you sends the bot upgrades
their stored `@username` to the numeric id automatically** (`telegram-bot/link.ts`).
Send `/start` once and alerts start working.

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

`POST /api/transactions` accepts two optional headers, `X-Actor-User-Id` and
`X-Actor-Telegram-Id`, naming who entered the transaction so their alert can be
skipped. They are honoured **only** from a caller holding the service token —
a browser session names its own user, so it cannot silence someone else's alert
by claiming to be them.

## Project Structure

```
ink-finance/
├── prisma/
│   └── schema.prisma       # Database models (fin_* tables)
├── shared/
│   └── notify.ts            # "transaction added" alerts (API + bot share this)
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
