# Nobryn

**Nobryn** is infrastructure for executing business transactions reliably across the systems and organizations involved.

> Nobryn makes multi-party business transactions actually complete.

The MVP focuses on **B2B purchase/order execution**:

```
Business intent
      ↓
Transaction created
      ↓
Accepted
      ↓
Fulfilling
      ↓
Delivered
      ↓
Completed
```

Transactions are supported by **evidence**, guarded by a strict **state machine**, and monitored for **exceptions** (supplier timeout, delivery delay, quantity mismatch). A transaction with an open blocking exception cannot complete, and completion requires a verified delivery confirmation.

## Project overview

- **Product surface:** landing page, authentication, workspace app (Overview, Transactions, Create Transaction, Transaction Detail, Exceptions, Counterparties, Integrations, Settings)
- **Core primitive:** transaction execution state + evidence + exceptions + activity, persisted in PostgreSQL
- **Simulated execution engine:** a deterministic, in-product engine advances transactions through the lifecycle and generates real evidence + activity records — no external enterprise systems required

## Architecture

```
├── src/                 # React 19 + TypeScript + Vite frontend
│   ├── components/      # AppShell, shared UI primitives, state timeline
│   ├── lib/             # API client, auth context, toast system, types
│   └── pages/           # Landing, auth, and application pages
├── server/              # Express 5 + TypeScript backend
│   ├── routes/          # /api/auth, /api (workspace-scoped resources)
│   ├── services/        # Transaction service (state machine, execution, evidence)
│   ├── domain.ts        # State machine, step/evidence definitions, Zod schemas
│   ├── auth.ts          # JWT middleware + workspace resolution
│   └── seed.ts          # Demo data seeder
├── prisma/
│   └── schema.prisma    # PostgreSQL data model
└── prisma.config.ts     # Prisma 7 config (datasource URL from env)
```

**Stack:** React 19, React Router 7, Vite, Tailwind CSS, Express 5, Prisma 7 (pg driver adapter), PostgreSQL, JWT auth, bcrypt password hashing, Zod validation.

## Local development

Requirements: Node.js 20+, Bun (or npm), a PostgreSQL database.

```bash
# 1. Install dependencies
bun install

# 2. Configure environment (see ENV_SETUP.md)
cp env.example .env   # then fill in DATABASE_URL / DATABASE_CA_CERT / JWT_SECRET

# 3. Create the database schema
bun run db:push

# 4. Seed demo data (optional but recommended)
bun run seed

# 5. Run the backend (terminal 1)
bun run dev:server

# 6. Run the frontend (terminal 2)
bun run dev
```

The frontend proxies `/api/*` to the backend (`API_PORT`, default `4000`). The frontend itself reads no environment variables — API calls use relative `/api/*` URLs, so no server secret is ever exposed to the browser.

**Development seed login:** `bun run seed` creates a development-only account (email and password defined in
`server/seed.ts`) owning the **Acme Corporation** sample workspace. It exists so
local development has data to work with — it is not a production account, is not
exposed anywhere in the application UI, and must not be seeded in production.

## Environment variables

See `ENV_SETUP.md`. Summary:

| Variable            | Required | Description                                                     |
| ------------------- | -------- | --------------------------------------------------------------- |
| `DATABASE_URL`       | Yes      | PostgreSQL connection string                                    |
| `DATABASE_CA_CERT`   | Yes (TLS)| PEM CA certificate used to verify the database server           |
| `JWT_SECRET`         | Yes (prod) | Secret used to sign auth tokens (dev-only fallback locally)   |
| `CORS_ORIGIN`        | No       | Comma-separated allowed origins (empty = allow all)             |
| `PORT`               | No       | Server port (default 4000; platform-provided in hosting)        |
| `API_PORT`           | Dev only | API port next to the Vite dev server (set by `dev:all`)         |

See `ENV_SETUP.md` for the full deployment checklist (Required / Optional / Development-only) and where each value comes from. A placeholder-only template lives in `env.example`.

Never commit real secrets. In production, set secrets through your hosting provider's environment settings.

## Database setup

The data model (Prisma/PostgreSQL): `User`, `Workspace`, `Counterparty`, `Transaction`, `TransactionItem`, `Evidence`, `Exception`, `ActivityEvent`. All workspace-scoped queries filter by the authenticated user's workspace.

**TLS:** the shared Prisma client (`server/prisma.ts`) connects with
`ssl: { ca: DATABASE_CA_CERT, rejectUnauthorized: true }` — the server
certificate chain is verified against the supplied CA and hostname
verification stays enabled. There is no verification bypass; both the API and
the seed use this single shared client.

```bash
bun run db:generate   # generate the Prisma client
bun run db:push       # push schema to the database (dev)
bun run db:deploy     # apply migrations (production)
```

## Seed data

`bun run seed` creates the **Acme Corporation** demo workspace:

- Counterparties: Global Components, North Supply, Acme Logistics
- `PO-10482` — Global Components — $184,500 — FULFILLING (active lifecycle with evidence + activity)
- `PO-10481` — Acme Logistics — $72,200 — COMPLETED (full successful lifecycle)
- `PO-10480` — North Supply — $31,900 — FULFILLING with an open **quantity mismatch** exception

The seeder is idempotent: it skips if the demo workspace already exists.

## Build command

```bash
bun run build          # frontend only: vite build -> dist/
bun run build:server   # backend: prisma generate + tsc -> dist-server/
```

## Start command

```bash
bun run start          # serves the API and the built frontend on $PORT (default 4000)
```

In production the Express server serves both the API (`/api/*`) and the static frontend from `dist/`, so a single process can be deployed.

## API structure

```
POST   /api/auth/register          POST   /api/auth/login
POST   /api/auth/logout            GET    /api/auth/me

GET    /api/workspace              PATCH  /api/workspace
PATCH  /api/account

GET    /api/counterparties         POST   /api/counterparties

GET    /api/transactions           POST   /api/transactions
GET    /api/transactions/:id       PATCH  /api/transactions/:id/state
POST   /api/transactions/:id/execute
POST   /api/transactions/:id/verify
GET    /api/transactions/:id/evidence
POST   /api/transactions/:id/evidence
POST   /api/transactions/:id/exceptions   (simulated demo exceptions)

GET    /api/exceptions             POST   /api/exceptions/:id/resolve
GET    /api/summary                GET    /api/health
```

All routes except `/api/auth/*` and `/api/health` require a Bearer token and resolve the caller's workspace; one workspace can never read another's data.

## State machine

```
CREATED → ACCEPTED → FULFILLING → DELIVERED → COMPLETED
```

- Invalid transitions return `409` with a human-readable message.
- Completion requires verified **Delivery confirmation** evidence and no open blocking exceptions.
- Exceptions (`OPEN` / `IN_PROGRESS` / `RESOLVED`) are first-class records; resolution requires a note and stores the timestamp and resolver.

## Deployment instructions

1. Provision a PostgreSQL database (e.g. Neon) and set `DATABASE_URL`.
2. Set `JWT_SECRET` to a strong random value; set `CORS_ORIGIN` to your domain.
3. Apply the schema: `bun run db:deploy` (or `bun run db:push` for a first deploy).
4. Optionally seed: `bun run seed`.
5. Build: `bun run build && bun run build:server`.
6. Start: `bun run start` (single process serves API + frontend).

Freebuff Cloud preview/production: the preview runs `bun run dev:all` (Vite + API with proxy). For production deploys the build command is `bun run build` and the start command is `bun run start`.

### Frontend deployment (Vercel)

The repository is a **single package** — one root `package.json` and one lockfile
(`bun.lock`) — with frontend and backend responsibilities separated by script and by
actual import usage (no workspace split is required):

| | Frontend (Vercel) | Backend |
| --- | --- | --- |
| Install | `bun install` (frozen lockfile in CI) | `bun install` |
| Build | `bun run build` → `vite build` only | `bun run build:server` → `prisma generate` + `tsc` |
| Output | `dist/` (static) | `dist-server/` |
| Start | — (static hosting) | `bun run start` |
| Env vars | **none** | `DATABASE_URL`, `DATABASE_CA_CERT`, `JWT_SECRET`, `CORS_ORIGIN`, `PORT` |

- **Root Directory:** repository root (the frontend lives at the root; `vercel.json` pins install/build/output).
- **Build isolation:** the Vercel build executes `vite build` only — it never starts Express, never runs Prisma migrations or seed, and never touches the database.
- **Frontend environment:** the frontend reads no environment variables and calls relative `/api/*` URLs, so no backend secret is ever required by or exposed to the frontend build.
- **Dependency split:** frontend build/runtime needs `react`, `react-dom`, `react-router-dom`, `vite`, `@vitejs/plugin-react`, TypeScript, Tailwind/PostCSS. Backend runtime needs `express`, `cors`, `prisma`, `@prisma/*`, `pg`, `bcryptjs`, `jsonwebtoken`, `zod`, `dotenv`. `src/` never imports any backend-only package; backend-only packages are never needed to build the frontend.
- `@vitejs/plugin-react` is imported by `vite.config.ts` and is declared in `devDependencies` — it must stay declared there so a clean install can resolve it.

## Demo script (5-minute walkthrough)

1. Log in with the seeded development account → Overview shows summary cards, recent transactions, open exceptions.
2. Open `PO-10480` → see the open quantity mismatch; resolve it with a note.
3. Open `PO-10482` → review state progression, evidence, and activity.
4. Click **Confirm delivery**, then **Verify completion** → transaction completes with evidence-based verification.
5. Create a new transaction from **Transactions → Create transaction** and advance it through the lifecycle with **Send to supplier → Start fulfillment → Confirm delivery → Verify completion**.
6. Use **More actions → Simulate exception** to create a real persisted exception and see completion blocked until it is resolved.
