# Render Deployment — ink-finance

**Status: ✅ Deployed and verified**

| Service | URL | Type | Status |
|---------|-----|------|--------|
| Frontend | https://ink-finance-web.onrender.com | Static Site (free) | 🟢 live |
| API | https://ink-finance-api.onrender.com | Web Service (free) | 🟢 live |
| Bot | https://ink-finance-bot.onrender.com | Web Service (free) | 🟢 live |

Verified endpoints:
```bash
curl https://ink-finance-api.onrender.com/api/health
# {"status":"ok","service":"ink-finance"}

curl https://ink-finance-bot.onrender.com/health
# {"status":"ok","service":"ink-finance-bot","pending":0,"startedAt":"..."}

curl -o /dev/null -w "%{http_code}" https://ink-finance-web.onrender.com/transactions
# 200  (SPA deep link resolves via rewrite rule)
```

---

## Service Configuration

Both services deploy from **https://github.com/Inkstellar/ink-finance** (branch `main`).

### API service (`ink-finance-api`, `srv-dan708jm8hqs73a9eimg`)

| Setting | Value |
|---------|-------|
| Build command | `npm install --include=dev && npx prisma generate` |
| Start command | `npx tsx server/index.ts` |
| Health check path | `/api/health` |
| Plan / Region | free / oregon |

Environment variables:
```
NODE_ENV=production
API_PORT=10000
TZ=Asia/Kolkata
DATABASE_URL=<Neon connection string>
BOT_TOKEN=<from .env.local>
AI_API_KEY=<from .env.local>
AI_BASE_URL=https://router.bynara.id/v1
AI_MODEL=agnes-2.5-flash
```

### Bot service (`ink-finance-bot`, `srv-dan70g6gekts73fufon0`)

| Setting | Value |
|---------|-------|
| Build command | `npm install --include=dev && npx prisma generate` |
| Start command | `npx tsx telegram-bot/index.ts` |
| Plan / Region | free / oregon |

Environment variables:
```
NODE_ENV=production
TZ=Asia/Kolkata
DATABASE_URL=<Neon connection string>
BOT_TOKEN=<from .env.local>
AI_API_KEY=<from .env.local>
AI_BASE_URL=https://router.bynara.id/v1
AI_MODEL=agnes-2.5-flash
VITE_API_URL=https://ink-finance-api.onrender.com
BOT_ALLOWED_USERS=
```

> `VITE_API_URL` is **required** — without it the bot defaults to
> `http://localhost:3456` and cannot reach the API on Render.

### Frontend static site (`ink-finance-web`, `srv-dan8f7rm8hqs73ae5dt0`)

| Setting | Value |
|---------|-------|
| Build command | `npm install --include=dev && npm run build` |
| Publish directory | `dist` |
| Plan | free (static sites are always free — no `--plan` flag allowed) |

Environment variables (**inlined at build time by Vite**):
```
VITE_API_URL=https://ink-finance-api.onrender.com
```

SPA rewrite rule (set via the Render API — the CLI has no flag for it):
```bash
API_KEY=$(grep 'key: rnd_' ~/.render/cli.yaml | awk '{print $2}')
curl -X PUT "https://api.render.com/v1/services/srv-dan8f7rm8hqs73ae5dt0/routes" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '[{"type":"rewrite","source":"/*","destination":"/index.html"}]'
```

> Without the rewrite, deep links (`/transactions`, `/users`, …) return 404 on
> refresh because React Router handles routing client-side.
>
> `VITE_API_URL` must be the **host root** (no `/api` suffix) — the frontend
> paths already include `/api` (`apiPost('/api/budgets', …)`).

---

## Lessons Learned (the hard way)

### 1. `npm install` skips devDependencies on Render

Render sets `NODE_ENV=production` during builds, so plain `npm install` skips
devDependencies — meaning `@types/express`, `@types/cors`, and `tsx` are missing.
`tsc` then fails with `TS7016: Could not find a declaration file`.

**Fix:** use `npm install --include=dev` in the build command.

### 2. Don't pre-compile — run TypeScript directly with `tsx`

Compiling with `tsc` fights `package.json`'s `"type": "module"`:
- `module: ES2020` → `tsc` emits ESM, fine
- `module: CommonJS` → `tsc` emits CJS, but Node treats `.js` as ESM → `exports is not defined`
- Renaming to `.cjs` breaks internal `require()` paths

Also, older `tsc` versions reject `moduleResolution: "node"` with
`TS5108: Option 'moduleResolution=node10' has been removed`.

**Fix:** skip compilation entirely — `npx tsx <entry>.ts` runs TS directly.

### 3. Free plan = web services only

`--type background_worker` is rejected on the free plan
(`only web services allowed for plan`). The bot therefore runs as a
**web service**, which expects an HTTP port binding. `telegram-bot/index.ts`
now starts a small health server on `$PORT` serving `/health`.

### 4. Telegram 409 Conflict during deploys

Render does zero-downtime deploys — the old and new instance briefly overlap,
and Telegram permits only one `getUpdates` poller per token, so the new instance
gets `409: Conflict`. `telegram-bot/index.ts` now retries with backoff
(up to 10 attempts) instead of calling `process.exit(1)`.

### 5. The frontend had latent typecheck errors

`npm run build` runs `tsc -p tsconfig.app.json && vite build`, but the Vite dev
server never typechecks — so these went unnoticed until the first production build:

- `Property 'env' does not exist on type 'ImportMeta'` — `src/vite-env.d.ts`
  was missing. Fixed by adding it with `/// <reference types="vite/client" />`
  plus a typed `ImportMetaEnv` declaring `VITE_API_URL`.
- `Property 'fontWeight' does not exist on type TableCellProps` in
  `Budget.tsx` and `Investments.tsx` — MUI v6 `TableCell` doesn't take
  `fontWeight` as a direct prop. Fixed with `sx={{ fontWeight: 600 }}`.

**Takeaway:** run `npm run build` locally before deploying; the dev server hides
type errors.

### 6. Render runs in UTC — the app thinks in IST

This is a single-timezone app (India), and the container is UTC. Two things
broke because of the 5:30 offset:

- `new Date().toISOString().slice(0, 10)` — used to pre-fill dates in the
  transaction/loan forms and the bot — is **UTC**, so any entry made between
  00:00 and 05:29 IST was dated the *previous* day. A receipt scanned at 1 am
  landed in yesterday's ledger. Fixed with `todayIST()`
  (`src/lib/format.ts`, `telegram-bot/dates.ts`), which formats `en-CA` in
  `Asia/Kolkata` to get `YYYY-MM-DD`.
- `GET /api/dashboard` decided "this month" from `new Date().getMonth()`. On the
  1st of a month before 05:30 IST the container still thought it was last month,
  so income/expenses briefly showed the wrong month. It now resolves the month in
  `Asia/Kolkata` explicitly.

`TZ=Asia/Kolkata` was added to both services' env vars (and to `render.yaml`)
so *future* local-time code is IST by default. Correctness does not depend on it
any more — the helpers name the timezone — so a service that hasn't picked up the
variable yet is not broken. Verified by running the formatters under
`TZ=America/New_York` and getting the right date anyway.

> The static site doesn't need `TZ`: it only affects the build, and the browser
> decides how dates render. `formatDate` pins IST so that's deterministic too.

### 7. The static-site build typechecks the server — and needs a fresh Prisma client

`tsconfig.app.json` includes `server`, not just `src`:

```json
"include": ["src", "server", "vite.config.ts"]
```

That's deliberate — it means a frontend deploy also typechecks the API — but it
makes the **web** build depend on `@prisma/client` being generated. The api and
bot build commands run `npx prisma generate`; the web one did not.

This stayed invisible until the Prisma schema and `server/index.ts` moved
together. Render caches `node_modules` between builds, so `npm install` reported
`up to date` and `@prisma/client`'s postinstall never re-ran — leaving a client
generated from the *previous* schema. Adding `FinLoan.userId` therefore broke the
static site:

```
server/index.ts(226,7): error TS2353: ... 'user' does not exist in type 'FinLoanInclude<DefaultArgs>'.
server/index.ts(248,7): error TS2353: ... 'userId' does not exist in type ...
==> Build failed
```

The api and bot deployed fine from the same commit — only the web failed, which
is what makes this one confusing.

**Fix:** `build` now generates the client itself, in every environment:

```json
"build": "prisma generate && tsc -p tsconfig.app.json && vite build"
```

`prisma generate` only reads the schema and needs no database connection, so this
is safe on a static site. Verified that the generated client then contains
`FinLoanInclude.user` and `FinLoanUncheckedCreateInput.userId`.

**Takeaway:** when the schema and server code change in the same commit, check
*all three* services, not just the api — a green api deploy does not mean the
static site built.

### 8. `matrix` is not available in a job-level `if`

The deploy workflow filters services on manual runs with
`inputs.service == 'all' || inputs.service == matrix.key`. Put that condition on
the **job** and the whole workflow file is invalid: every run dies in 0s with
*"This run likely failed because of a workflow file issue"* and no job logs to
read. The `matrix` context only exists at **step** level, so the condition has to
be repeated on each step. (Contrast `jobs.<id>.name`, where `matrix` *is* fine.)

---

## ⚠️ Free-tier spin-down (important)

Render's free tier suspends a **web service** after ~15 minutes without inbound
HTTP traffic. A Telegram bot only makes *outbound* calls, so it will be
suspended and stop answering messages until its HTTP endpoint is hit again.

Observed: the bot's health endpoint reported `startedAt` matching the moment of
our first request, not the deploy time — proof it had been suspended.

> **Static sites are not affected** — they're served from Render's CDN and never
> spin down. Only the API and bot web services do.

### Options

| Option | Cost | Notes |
|--------|------|-------|
| **Keep-alive pings** | free | Ping `/health` every 5–10 min with UptimeRobot / cron-job.org |
| **Starter plan** | $7/mo per service | No spin-down; zero cold starts |
| **Background Worker** | $7/mo | Purpose-built for always-on processes |
| **Move bot to Railway/Fly.io** | ~$2–5/mo | Always-on alternative |

**Recommended for now:** add a free uptime monitor pinging
`https://ink-finance-bot.onrender.com/health` every 5 minutes.

---

## Redeploying

**Just push.** `.github/workflows/deploy.yml` deploys all three services on every
push to `main`, waits for each deploy to report `live`, then health-checks the
deployed URL. Watch it with `gh run list --repo Inkstellar/ink-finance`, or in
the Actions tab.

> **Why not Render's own Auto-Deploy toggle?** It *is* on for all three services
> (`autoDeploy: "yes"`, `branch: "main"`) — but it can never fire. The services
> are connected as a **public Git repository**: `GET /v1/services/{id}` returns
> `repo` as a bare URL string with **no repo `id`**, and a public-repo connection
> has no push webhook attached, so nothing tells Render about the push. That is
> why every deploy before 2026-09-20 carries `trigger: api` (started by hand)
> instead of `trigger: git`. Native auto-deploy would need each service
> reconnected through the **Render GitHub App** in the dashboard; the Actions
> workflow achieves the same thing without that step.

Requires one repository secret (Render → Account Settings → API Keys):

```bash
gh secret set RENDER_API_KEY --repo Inkstellar/ink-finance
```

Manual run: Actions → **Deploy to Render** → *Run workflow* → pick
`all` / `web` / `api` / `bot`, and tick **clear the build cache** when
dependencies changed (stale `@prisma/client` — see lesson 7).

There is deliberately **no path filtering**: any push redeploys all three. It is
cheap here and avoids the "changed X, forgot to deploy X" failure mode.

Manual deploy via Render CLI:
```bash
export PATH="$HOME/.local/bin:$PATH"
render workspace set tea-dan6k0rm8hqs73a83pg0
render deploys create srv-dan708jm8hqs73a9eimg --confirm   # API
render deploys create srv-dan70g6gekts73fufon0 --confirm   # Bot
```

View logs:
```bash
render logs --resources srv-dan70g6gekts73fufon0 --output text | tail -30
```

---

## Local dev against the deployed stack

Once the services are live you usually don't need a local API server — point the
local Vite dev server at the deployed one and work against real data.

```bash
npm run render:status          # wake the (free-tier) services + health check
npm run dev:use-render-server  # Vite on :5179, browser -> https://ink-finance-api.onrender.com
```

| Command | Runs locally | API it talks to |
|---------|--------------|-----------------|
| `npm run dev` | API + web | local (`:3456`) |
| `npm run dev:all` | API + web + bot | local |
| `npm run dev:use-render-server` | web only | **Render API** |
| `npm run dev:use-render-server:with-bot` | web + bot | **Render API** |
| `npm run render:status` | nothing | pings api / bot / web |

Wiring:

- **`.env.render`** — committed profile holding only the three public URLs
  (`VITE_API_URL`, `WEB_URL`, `BOT_URL`). No secrets.
- **`scripts/run-with-env.mjs`** — loads env files left-to-right with **last
  file wins**, so `.env.local` (BOT_TOKEN, AI_API_KEY) sits underneath
  `.env.render` (URLs). Prints the effective config with secrets masked.
- **`vite --mode render`** — Vite's own precedence loads `.env.render` after
  `.env` / `.env.local`, so the deployed URL wins. Verified: `MODE=render`,
  `PROD=false` (still a dev build).

### Why `dev:use-render-server` does not start the bot

Telegram permits exactly **one** `getUpdates` poller per bot token. The deployed
bot on Render is already polling, so a second local poller provokes
`409 Conflict` on both sides — the local one retries 10× and exits, and the
deployed one can crash out of its polling loop. The default command therefore
runs the web only and leaves Telegram to Render.

`dev:use-render-server:with-bot` exists for debugging the bot itself: suspend the
Render bot first (Dashboard → the service → Suspend), then run it.

### Free-tier cold starts

`npm run render:status` doubles as a wake-up call. Observed on a real run:

```
✅ api 200  32856ms  ⏱️  cold start (instance was suspended)
✅ bot 200  41835ms  ⏱️  cold start (instance was suspended)
✅ web 200  478ms
```

The `startedAt` field in the bot's health payload is a reliable tell — if it is
only seconds old, the request you just made is what woke the instance. Static
sites never sleep, which is why `web` responds instantly.

---

## Authentication

Every `/api` route now needs a session, except `/api/health` (the keepalive
Action pings it) and `/api/auth/*` (you have to be able to sign in). Three pieces
make that work in production:

**1. `/api` is proxied through the static site.** A rewrite rule
`/api/*` → `https://ink-finance-api.onrender.com/api/*`, placed **above** the
SPA fallback (`/*` → `/index.html`) because rules apply top-down. This is
required, not tidiness: `onrender.com` is on the **Public Suffix List**, so
`ink-finance-web.onrender.com` and `ink-finance-api.onrender.com` are different
**sites**, and an API-set cookie would be a third-party cookie that Safari drops
silently. Same-origin also removes the need for CORS on normal traffic.

```bash
# Apply the routes (order matters; /api/* must be first)
API_KEY=$(grep 'key: rnd_' ~/.render/cli.yaml | awk '{print $2}')
curl -s -X PUT "https://api.render.com/v1/services/srv-dan8f7rm8hqs73ae5dt0/routes" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '[{"type":"rewrite","source":"/api/*","destination":"https://ink-finance-api.onrender.com/api/*"},
       {"type":"rewrite","source":"/*","destination":"/index.html"}]'
```

**2. New environment variables.** On `ink-finance-api`: `AUTH_SECRET`,
`AUTH_TRUST_HOST=true`, `SERVICE_TOKEN`, `ALLOWED_ORIGINS`. On `ink-finance-bot`:
`SERVICE_TOKEN` (**same value**). The SPA no longer needs `VITE_API_URL` — it
calls a relative `/api`. `server/index.ts` sets `app.set('trust proxy', true)` so
Auth.js sees the forwarded HTTPS scheme and may set a `Secure` cookie.

```bash
openssl rand -hex 32   # AUTH_SECRET   (rotating this signs everyone out)
openssl rand -hex 32   # SERVICE_TOKEN (same value on api + bot)
```

**3. The bot authenticates with `X-Service-Token`.** It has no browser and no
cookie; `server/auth-middleware.ts` accepts the shared secret with a
timing-safe comparison. Without it, the bot's every API call returns 401.

Set a first login with `npm run user:set-password` (it hashes with bcrypt and
never echoes the password). Pointing that script at production writes to the real
database — it reads `DATABASE_URL` from `.env`, so be sure which one you mean.

Post-deploy verification:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://ink-finance-api.onrender.com/api/transactions  # 401
curl -s -o /dev/null -w '%{http_code}\n' https://ink-finance-api.onrender.com/api/health        # 200
curl -s -o /dev/null -w '%{http_code}\n' https://ink-finance-web.onrender.com/api/health        # 200 (proxy works)
```

Then load the web app: it should show the login screen, and signing in should
reach the dashboard. `npm run test:auth` with `API_BASE` set to the deployed API
exercises the whole flow (it creates and deletes a throwaway user).

---

## 🔐 Security note

`BOT_TOKEN`, `DATABASE_URL`, and `AI_API_KEY` are stored **only** as Render
environment variables — never in the repository. Earlier commits leaked these
into `DEPLOY_RENDER.md`; that file now uses placeholders.

Because the token was exposed in git history and via GitHub secret scanning,
**rotate the Telegram bot token** via @BotFather (`/revoke`) and update the env
var on both Render services.

`.env.render` is committed **on purpose** — it holds only public service URLs.
Anything secret stays in `.env` / `.env.local`, which `.gitignore` covers via
`.env`, `.env.local`, and `.env*.local` (so private overrides like
`.env.render.local` are ignored automatically).
