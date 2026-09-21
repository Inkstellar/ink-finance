# Ink Finance

Personal finance manager for tracking home finances, personal investments, and loans.

## Features

- **Dashboard** — Net worth overview, monthly income/expense summary, recent transactions
- **Accounts** — View and manage the accounts behind the net-worth figure; add, edit, archive and restore
- **Transactions** — Record income, expenses, transfers, investment buys/sells, loan payments
- **Investments** — Track stocks, mutual funds, ETFs, bonds, crypto, gold holdings with P&L
- **Loans** — Track active loans (home, car, personal), record EMI payments, view amortization; edit any loan's terms, change its status, remove a mis-entered payment, or delete it
- **Budget** — Set monthly budgets per category, track spending progress
- **Calendar** — A shared household calendar: mark events for either person, colour-coded by owner, with multi-day and timed events (see below)
- **Users** — Manage household members, their logins and profile pictures
- **Installable** — a PWA, so it can be added to a phone's home screen and open full screen (see below)
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
- `fin_events` — Shared household calendar entries (see [Calendar](#calendar))

### Backups

```bash
npm run db:backup                            # → backups/ink-finance-<timestamp>.json
npm run db:backup -- --out path.json         # choose the destination
npm run db:backup -- --inspect path.json     # summarise a backup, change nothing
npm run db:backup -- --restore path.json --yes
```

**This exists because there was no backup.** In September 2026 a set of loans was
found to be missing, and every recovery route turned out to be closed: Neon
refuses `pageinspect` (it needs superuser, which Neon does not grant) so the
deleted rows could not be read back out of the heap even though they were still
physically there; Render keeps only a few hours of logs and does not log
requests; and the point-in-time window is a branch property that is not readable
from SQL. The root cause was the boring one — nothing had ever been saved.

Dumping is **read-only** (`SELECT` only). The file holds every `fin_*` table plus
the column types needed to decode it, and it is **real financial data**, so
`backups/` is gitignored — keep it out of the repository.

Restoring is opt-in twice over. It needs `--restore` *and* `--yes`, and it skips
any table that already contains rows unless `--force` is also passed. Conflicts
on a primary key are ignored (`ON CONFLICT DO NOTHING`), so a restore can never
clobber a live row; the rows are inserted in foreign-key order (`fin_users`
before `fin_accounts` before `fin_loans` before `fin_loan_payments`) so the
constraints hold.

Timestamps round-trip as **exact instants**. Dates in this app are calendar days
stored as UTC midnight, so an encoder that reached for a local-time formatter
would shift every date by a day. `npm run test:backup` (62 checks) pins that two
ways: it scans `scripts/backup-format.mjs` for local-time APIs, and it re-encodes
a date in child processes pinned to `Pacific/Kiritimati` (+14), `Pacific/Midway`
(−11), `America/New_York` and `UTC`, requiring identical output.

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
npm run test:events  # calendar events: month windows, multi-day overlap, validation
npm run test:privacy # no endpoint leaks a password hash or an avatar
npm run test:alerts  # transaction alerts: who is messaged, and who is not
npm run test:bot     # pure analytics: templates, bucketing, reports
npm run test:notify  # pure: alert wording, escaping, recipient selection
npm run test:pwa     # pure: manifest, icons, head tags, the service worker
npm run test:calendar # pure: the month grid, day bucketing, timezone independence
npm run test:backup  # pure: backup encode/decode, and dates that must not shift
npm run icons        # regenerate public/icon-* from scripts/icon-art.mjs
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

### Alerts

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

**Loans alert too**, because a loan is not a transaction: recording a payment
from the web UI updates the loan and creates nothing else, so without its own
alert the other person would never hear about it.

```
🏦 Loan payment

💸 -₹43,391.00
📝 Housing loan
   principal ₹40,000.00 · interest ₹3,391.00
📉 Outstanding now ₹49,56,609.00
📅 21 Sep 2026

✍️ Recorded by Kousi
```

Adding a loan says so, with the lender, tenure, rate and EMI. **Deleting** one
says so as well — a shared record of debt should not disappear quietly.

One action produces one message. The bot's `loanpay` template creates a
transaction *and* a payment on the loan, so it marks the transaction
`X-Suppress-Alert: 1` and lets the loan alert through, because that is the one
carrying the outstanding balance. The header is honoured only from a caller
holding the service token, like the actor headers below.

Only users with a Telegram id set on the Users page receive alerts. The wording
lives in `shared/notify.ts`, imported by both the API and the bot, so the two
paths cannot drift. Alerts are sent *after* the response and never throw: a
Telegram failure cannot fail the write that caused it.

Set `WEB_URL` on the API service for the "Open in app" button; without it the
alert is sent without the button.

**The id must be numeric.** The Bot API cannot deliver a private message to an
`@username` — `sendMessage` answers `400 chat not found` — so a handle typed
into the Users page looks correct and silently breaks alerts. You do not have to
copy the number yourself: the numeric id is only knowable while someone is
talking to the bot, so **the first message either of you sends the bot upgrades
their stored `@username` to the numeric id automatically** (`telegram-bot/link.ts`).
Send `/start` once and alerts start working — and `/start` will tell you which
of the two states you are in.

## Install it on a phone (PWA)

The web app is installable, so it can live on a home screen and open full
screen with no browser chrome.

- **Android / desktop Chrome** — an **Install app** entry appears at the bottom
  of the sidebar. Tapping it shows the browser's own install dialog. (Chrome
  also offers its own install icon in the address bar.) The entry only exists
  while the browser has an install prompt to give, and disappears once installed.
- **iPhone / iPad** — the same entry explains where the button is, because iOS
  has no programmatic install: **Share → Add to Home Screen**. Only Safari can
  do it, which is why Chrome and Firefox on iOS are deliberately not offered
  these instructions.

### What is in the repository

| File | Purpose |
|------|---------|
| `public/manifest.json` | name, icons, `display: standalone`, theme colours, long-press shortcuts |
| `public/sw.js` | the service worker (caching rules below) |
| `public/icon.svg` + 4 PNGs | the mark, at every size the platforms ask for |
| `scripts/icon-art.mjs` | the mark **as geometry** — the single source for the SVG and every PNG |
| `scripts/generate-icons.mjs` | writes the files (`npm run icons`) |
| `src/lib/pwa.ts` | service-worker registration and install state |
| `src/components/InstallApp.tsx` | the sidebar entry and its dialog |
| `src/components/OfflineBanner.tsx` | the "you are offline" warning |

The icons are **committed**, not built: Render serves `dist/` verbatim and a
static host cannot rasterise an SVG at request time. There is no image library
involved — `scripts/icon-art.mjs` rasterises the mark with a 4×4 supersampled
scanline loop and encodes the PNG with `node:zlib`, so the icons are
reproducible in CI with no dependencies. `npm run test:pwa` fails if the
committed PNGs stop matching the geometry, which is the only thing standing
between "someone tweaked the art" and "the icons silently never changed".

Three icon variants exist because the platforms disagree: the favicon is
rounded and has a large glyph, the **maskable** one is full-bleed with a smaller
glyph (Android crops it to a circle of 80% diameter — a square glyph has to fit
inside that, so it is deliberately smaller), and `apple-touch-icon.png` is
full-bleed and opaque because iOS masks it itself and turns transparency black.

### Service worker caching rules

| Request | Strategy | Why |
|---------|----------|-----|
| `/api/*` | **never intercepted** | This is a finance app. A cached balance is a wrong balance, and a cached success for a write would be far worse. Offline reads therefore fail — on purpose. |
| navigations | network first → cached shell | Network first so a deploy is picked up on the next launch rather than serving an `index.html` that references asset filenames the server no longer has. |
| `/assets/*` | cache first | Vite content-hashes these, so a given URL is immutable. |
| everything else | stale-while-revalidate | Icons, the manifest, and the Google Fonts CSS/woff2 (cross-origin, so opaque responses — status 0 is accepted as cacheable). |

`VERSION` at the top of `public/sw.js` is what invalidates everything: bumping
it makes `activate` delete every cache whose name does not start with the new
version.

Two deliberate choices worth not "fixing":

- **`skipWaiting()` + a one-time reload.** A new worker takes over immediately
  and the page reloads itself on `controllerchange`, so the running bundle and
  the worker are always from the same deploy. The alternative — letting the old
  worker serve the old cache until every tab closes — leaves the app pinned to a
  stale shell.
- **No `viewport-fit=cover`, no safe-area padding, no iOS splash screens.** The
  status bar is left at iOS's `default` style so its dark text stays legible
  above the white mobile app bar. Edge-to-edge would need `env(safe-area-inset-*)`
  padding on the app bar, drawer and content, and getting it wrong puts the clock
  on top of the toolbar.

`npm run test:pwa` (91 checks) drives the **shipped** `public/sw.js` through a
sandboxed Cache/fetch harness rather than testing a copy of the rules, asserts
the committed PNGs still match the art, and checks the manifest, the icons and
the head tags agree with each other. Removing the `/api` guard from the worker
makes it fail — that was verified by planting it and reverting.

## Calendar

A shared household calendar at `/calendar`. Both people's events live on one
grid, colour-coded by owner (`fin_users.color`), so "whose is that?" is answered
at a glance rather than by opening each one.

- **Month grid**, Sunday-first, with the neighbouring months' days borrowed to
  fill the first and last weeks. Those borrowed days are dimmed but real: they
  carry their own events, so a trip crossing a month boundary shows on both
  sides of it.
- **Multi-day events** land on *every* day they span, not just the day they
  start.
- **Timed or all-day.** An event with no `startTime` is all-day.
- **Colour-coded by owner**, with a legend above the grid. An event with no owner
  is grey and labelled *Shared*.
- **Agenda** for the selected day, plus a **Coming up** list for the next 60
  days. Clicking a row in it jumps to that day, following it into its month.
- **Phone layout:** the day cells drop to coloured dots below `sm`, because a
  chip with a readable title needs ~90px and a 390px phone gives each column
  ~48px. The agenda below the grid carries the detail.
- Keyboard accessible: each cell is a real focusable button with a descriptive
  `aria-label` ("Tuesday, 15 September, 4 events").

### Dates are dates, not instants

`fin_events.date` is stored as **UTC midnight of the intended calendar day**,
exactly like `fin_transactions.date`. Every calculation in `src/lib/calendar.ts`
goes through `Date.UTC`, so the grid is identical whether the device is in IST,
UTC or California — `npm run test:calendar` proves it by recomputing the grid in
child processes at UTC+14 and UTC−11 and requiring byte-identical output, and by
scanning the source for local-time getters.

Two traps worth knowing, both of which produced a visibly wrong page before they
were fixed:

- **The API sends `2026-09-21T00:00:00.000Z`, not `2026-09-21`.** `parseDayKey`
  rejects the ISO form, so bucketing events with it silently dropped every event
  the API returned and left the grid empty while the agenda looked fine.
  `toDayKey` accepts either form; use it for anything that came off the wire.
- **The fetch must use `gridRange`, not `monthRange`.** The grid shows days from
  the adjacent months, so asking only for the month leaves the first and last
  rows empty while the same day shows its events one month over.

### The month window is an overlap, not a containment

`GET /api/events?from=&to=` returns events that **overlap** the window, not ones
that start inside it — otherwise a trip running 28 Aug – 3 Sep would vanish from
September's grid. An event qualifies when it starts on or before `to` and reaches
on or after `from`, with `date` standing in for `endDate` when there is none.
`npm run test:events` pins that behaviour, and `scripts/events-smoke.mjs` proves
it against the real API and a real database.

Applied to the database with `prisma/add-events-table.sql` (the Render build only
runs `prisma generate`, so schema changes are applied by hand):

```bash
npx prisma db execute --file prisma/add-events-table.sql
```

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
| GET/POST | `/api/events` | List events overlapping a date window / create one |
| PUT/DELETE | `/api/events/:id` | Update / delete an event |

`POST /api/transactions` accepts two optional headers, `X-Actor-User-Id` and
`X-Actor-Telegram-Id`, naming who entered the transaction so their alert can be
skipped. They are honoured **only** from a caller holding the service token —
a browser session names its own user, so it cannot silence someone else's alert
by claiming to be them.

## Project Structure

```
ink-finance/
├── prisma/
│   ├── schema.prisma       # Database models (fin_* tables)
│   └── add-events-table.sql # fin_events — applied by hand (see Calendar)
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
│   │   ├── InstallApp.tsx   # "Install app" entry + Android/iOS dialogs
│   │   ├── OfflineBanner.tsx
│   │   └── StatCard.tsx
│   ├── hooks/
│   │   ├── useApi.ts        # Data fetching hook
│   │   └── useInstallState.ts
│   ├── lib/
│   │   ├── api.ts           # API client
│   │   ├── calendar.ts      # Month grid + day bucketing (timezone-free)
│   │   ├── pwa.ts           # Service-worker registration + install state
│   │   └── format.ts        # INR formatting helpers
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── Calendar.tsx     # Shared household calendar
│   │   ├── Transactions.tsx
│   │   ├── Investments.tsx
│   │   ├── Loans.tsx
│   │   └── Budget.tsx
│   ├── App.tsx              # Router + layout
│   ├── main.tsx             # Entry point
│   └── theme.ts             # MUI theme
├── public/                  # Copied verbatim into dist/ by Vite
│   ├── manifest.json
│   ├── sw.js                # Service worker (never caches /api)
│   └── icon.svg, icon-*.png, apple-touch-icon.png
├── scripts/
│   ├── icon-art.mjs         # The app mark, as geometry
│   ├── generate-icons.mjs   # npm run icons
│   ├── pwa.test.mjs         # npm run test:pwa
│   ├── calendar.test.ts     # npm run test:calendar
│   ├── events-smoke.mjs     # npm run test:events (needs a running API)
│   ├── db-backup.mjs        # npm run db:backup — dump / inspect / restore
│   ├── backup-format.mjs    # pure encode/decode for the backup file
│   ├── backup-format.test.mjs # npm run test:backup
│   ├── run-with-env.mjs     # run a command with layered .env files
│   └── render-status.mjs    # ping the deployed Render services
├── .env.local               # Secrets + local URLs (gitignored)
├── .env.render              # Render profile: deployed URLs only (committed)
├── .gitignore
├── package.json
├── vite.config.ts
└── tsconfig.json
```
