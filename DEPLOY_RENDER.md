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

Auto-deploy is enabled — pushing to `main` on GitHub triggers a build.

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

## 🔐 Security note

`BOT_TOKEN`, `DATABASE_URL`, and `AI_API_KEY` are stored **only** as Render
environment variables — never in the repository. Earlier commits leaked these
into `DEPLOY_RENDER.md`; that file now uses placeholders.

Because the token was exposed in git history and via GitHub secret scanning,
**rotate the Telegram bot token** via @BotFather (`/revoke`) and update the env
var on both Render services.
