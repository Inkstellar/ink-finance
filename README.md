# Ink Finance

Personal finance manager for tracking home finances, personal investments, and loans.

## Features

- **Dashboard** — Net worth overview, monthly income/expense summary, recent transactions
- **Transactions** — Record income, expenses, transfers, investment buys/sells, loan payments
- **Investments** — Track stocks, mutual funds, ETFs, bonds, crypto, gold holdings with P&L
- **Loans** — Track active loans (home, car, personal), record EMI payments, view amortization
- **Budget** — Set monthly budgets per category, track spending progress

## Tech Stack

- **Frontend:** React 18 + TypeScript + MUI (Material UI) + Vite
- **Backend:** Express.js API server with Prisma ORM
- **Database:** PostgreSQL (Neon) — shared with the puck-nextjs-starter project
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
