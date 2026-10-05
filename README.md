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
├── client/              # Frontend package — independently deployed (Vercel)
│   ├── src/             # React 19 + TypeScript + Vite application
│   │   ├── components/  # AppShell, shared UI primitives, state timeline
│   │   ├── lib/         # API client, auth context, toast system, types
│   │   └── pages/       # Landing, auth, and application pages
│   ├── package.json     # Frontend-only dependencies (react, vite, @vitejs/plugin-react, tailwind…)
│   ├── bun.lock         # Client lockfile — installs only the frontend graph
│   ├── vite.config.ts   # Vite config (dev proxy to the API on :4000)
│   ├── tailwind.config.js / postcss.config.js / tsconfig.json
│   └── vercel.json      # Vercel install/build/output (Root Directory: client)
├── server/              # Backend package — independently deployed
│   ├── routes/          # /api/auth, /api (workspace-scoped resources)
│   ├── services/        # Transaction service (state machine, execution, evidence)
│   ├── domain.ts        # State machine, step/evidence definitions, Zod schemas
│   ├── auth.ts          # JWT middleware + workspace resolution
│   ├── prisma.ts        # Shared Prisma client (TLS verification)
│   ├── seed.ts          # Demo data seeder
│   ├── scripts/         # verify-tls.mjs diagnostic
│   ├── package.json     # Backend-only dependencies (express, prisma, pg, bcrypt…)
│   ├── bun.lock         # Server lockfile — installs only the backend graph
│   ├── tsconfig.json    # Backend TypeScript config (emits server/dist/)
│   ├── prisma/
│   │   └── schema.prisma  # PostgreSQL data model
│   └── prisma.config.ts   # Prisma 7 config (datasource URL from env)
├── package.json         # Root orchestrator: runs dev/build/typecheck across both packages
└── bun.lock             # Orchestrator-only lockfile (concurrently)
```

**Stack:** React 19, React Router 7, Vite, Tailwind CSS, Express 5, Prisma 7 (pg driver adapter), PostgreSQL, JWT auth, bcrypt password hashing, Zod validation.

## Local development

Requirements: Node.js 20+, Bun (or npm), a PostgreSQL database.

```bash
# 1. Install dependencies (root orchestrator + client + server)
bun install
bun install --cwd client
bun install --cwd server

# 2. Configure environment (see ENV_SETUP.md)
cp env.example .env   # then fill in DATABASE_URL / DATABASE_CA_CERT / JWT_SECRET
#    canonical location is the repository root; server/.env is an optional override

# 3. Create the database schema
bun run db:push

# 4. Seed demo data (optional but recommended)
bun run seed

# 5. Run the backend (terminal 1)
bun run dev:server

# 6. Run the frontend (terminal 2)
bun run dev
```

All root scripts delegate into `client/` or `server/` (`bun run --cwd …`), so the
commands above work from the repository root; you can equally `cd client` / `cd server`
and run that package's scripts directly.

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
bun run build          # frontend only: vite build -> client/dist/
bun run build:server   # backend: prisma generate + tsc -> server/dist/
```

Each package also builds standalone: `cd client && bun run build`, `cd server && bun run build`.

## Start command

```bash
bun run start          # serves the API and the built frontend on $PORT (default 4000)
```

In production the Express server serves both the API (`/api/*`) and the static frontend from `client/dist/`, so a single process can be deployed.

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

Freebuff Cloud preview/production: the preview runs `bun run dev:all` (Vite + API with proxy, orchestrated from the root package). For production deploys the install command is `bun install && bun install --cwd client && bun install --cwd server`, the build command is `bun run build && bun run build:server` (produces `client/dist/` + `server/dist/`), and the start command is `bun run start`.

### Frontend deployment (Vercel)

The repository is split into two independent packages plus a root orchestrator:
`client/` (frontend) and `server/` (backend), each with its own `package.json` and
`bun.lock`. A clean install inside `client/` installs only frontend dependencies; a
clean install inside `server/` installs only backend dependencies.

| | Frontend (Vercel) | Backend |
| --- | --- | --- |
| Root Directory | `client` | `server/` on your backend host |
| Install | `bun install` (uses `client/bun.lock`) | `bun install` (uses `server/bun.lock`) |
| Build | `bun run build` → `vite build` only | `bun run build` → `prisma generate` + `tsc` |
| Output | `client/dist` (static) | `server/dist` |
| Start | — (static hosting) | `bun run start` |
| Env vars | **none** | `DATABASE_URL`, `DATABASE_CA_CERT`, `JWT_SECRET`, `CORS_ORIGIN`, `PORT` |

- **Vercel settings:** Root Directory `client`, Build Command `bun run build`,
  Output Directory `dist`, Framework Vite (`client/vercel.json` pins install/build/output).
  Vercel only ever installs and builds `client/` — it never runs Prisma, migrations,
  seed, tsc for the server, or Express.
- **Frontend environment:** the frontend reads no environment variables and calls
  relative `/api/*` URLs, so no backend secret is ever required by or exposed to the
  frontend build. Never put `DATABASE_URL`, `DATABASE_CA_CERT`, or `JWT_SECRET` in
  client environment variables.
- **Dependency split:** `client/package.json` declares `react`, `react-dom`,
  `react-router-dom`, `vite`, `@vitejs/plugin-react`, TypeScript, Tailwind/PostCSS —
  and nothing from the backend. `server/package.json` declares `express`, `cors`,
  `prisma`, `@prisma/*`, `pg`, `bcryptjs`, `jsonwebtoken`, `zod`, `dotenv`, `tsx` —
  and nothing from the frontend.
- **Lockfiles:** `client/bun.lock` and `server/bun.lock` are independent; the root
  `bun.lock` covers only the orchestrator (`concurrently`). Neither side needs the
  other's `node_modules`.

**How `/api/*` reaches a separately deployed backend:** the client keeps using
relative `/api/*` URLs (unchanged). Two supported deployment shapes:

1. **Single process (default):** build the client, then `server` serves `client/dist`
   and the API from the same origin — relative `/api/*` works with no proxy config.
2. **Split origins (Vercel + separate API):** add a rewrite in `client/vercel.json`
   once the backend origin exists:

   ```json
   "rewrites": [{ "source": "/api/:path*", "destination": "https://YOUR_BACKEND_ORIGIN/api/:path*" }]
   ```

   No backend URL is hardcoded in the repository because none exists yet; the only
   localhost reference is the development-only Vite proxy (`/api` → `localhost:4000`).
   Never use localhost in production.

## Demo script (5-minute walkthrough)

1. Log in with the seeded development account → Overview shows summary cards, recent transactions, open exceptions.
2. Open `PO-10480` → see the open quantity mismatch; resolve it with a note.
3. Open `PO-10482` → review state progression, evidence, and activity.
4. Click **Confirm delivery**, then **Verify completion** → transaction completes with evidence-based verification.
5. Create a new transaction from **Transactions → Create transaction** and advance it through the lifecycle with **Send to supplier → Start fulfillment → Confirm delivery → Verify completion**.
6. Use **More actions → Simulate exception** to create a real persisted exception and see completion blocked until it is resolved.
