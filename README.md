# Ink Finance

Personal finance manager for tracking home finances, personal investments, and loans.

## Features

- **Dashboard** — Net worth overview, monthly income/expense summary, recent transactions
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
├── .env.local               # Database URL (same as puck project)
├── .gitignore
├── package.json
├── vite.config.ts
└── tsconfig.json
```
