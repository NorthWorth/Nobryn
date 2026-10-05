# Nobryn environment variables

Copy this file to `.env` (never commit `.env`) and fill in the values. The
placeholder-only template lives in `env.example`.

## Deployment checklist

### Required

Variables Nobryn cannot run without.

| Variable          | What it is                                                            | Where you obtain it                                                  |
| ----------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`    | PostgreSQL connection string used by Prisma and the API server        | Your PostgreSQL provider's connection string (e.g. Aiven / Neon)      |
| `DATABASE_CA_CERT`| Complete PEM CA certificate used to verify the database TLS server    | Your database provider's CA certificate (e.g. shown for your Aiven PostgreSQL service) |
| `JWT_SECRET`      | Secret that signs and verifies auth (JWT) session tokens              | Generate yourself: `openssl rand -hex 32` — store it only in the host's environment settings |

Notes on `DATABASE_CA_CERT`:

- Store the **complete** certificate, `BEGIN` through `END`.
- A multi-line PEM may be stored as a single line with literal `\n` escapes;
  the server normalizes it before use.
- If the value is missing, incomplete, or unparseable, the API and seed refuse
  to connect (TLS verification cannot be bypassed).
- Never commit the certificate value and never expose it to the frontend or in
  API responses.

### Optional

Variables only required for optional behavior.

| Variable     | What it is                                                        | Where you obtain it                                      |
| ------------ | ----------------------------------------------------------------- | -------------------------------------------------------- |
| `CORS_ORIGIN`| Comma-separated allowed browser origins. Empty = allow all (development only). For the split Vercel + Render deployment, set this on Render to the deployed Vercel frontend origin (e.g. `https://your-app.vercel.app`). | Your deployed Vercel frontend origin(s)                          |
| `PORT`       | Port the production server binds to (API only). Usually injected by the hosting platform. | Platform-provided; local default `4000`                   |

### Development-only

Needed only for local development/testing. Do not set these in production.

| Variable     | What it is                                                                     | Where it comes from                     |
| ------------ | ------------------------------------------------------------------------------ | --------------------------------------- |
| `API_PORT`   | Backend port used when the API runs next to the Vite dev server (set by `bun run dev:all`; the Vite proxy targets it) | Set by the dev script; local default `4000` |
| `TLS_BOGUS_CA` | Path to a bogus CA PEM used only by `server/scripts/verify-tls.mjs` to prove that TLS verification rejects untrusted certificates | Optional; defaults to `/tmp/fake-ca.pem` |

## Database (required)

PostgreSQL connection string used by Prisma.

- Local: `postgresql://nobryn:nobryn@localhost:5432/nobryn`
- Neon:  `postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`

```
DATABASE_URL=
```

## Database CA certificate (required for TLS-verified databases)

PEM certificate of the database server's certificate authority (e.g. the CA
certificate shown for your Aiven PostgreSQL service). Used together with
`DATABASE_URL`: the connection stays encrypted and the server certificate is
verified against this CA with hostname verification enabled. TLS verification
cannot be bypassed — if this value is missing, incomplete, or unparseable the
API and seed refuse to connect.

```
DATABASE_CA_CERT=-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----
```

## Auth (required in production)

Secret used to sign session tokens. Generate with `openssl rand -hex 32`.
Outside local development the server refuses to start without it.

```
JWT_SECRET=
```

## Server

```
PORT=4000
```

The production backend is deployed as an API-only service (Render, root directory
`server`). It serves `/api/*` and does not serve the frontend. The frontend is
deployed separately (Vercel, root directory `client`).

## CORS (optional)

Comma-separated list of allowed origins. Leave empty to allow all (development only).

```
CORS_ORIGIN=https://your-production-domain.com
```

## Frontend

The frontend reads exactly one environment variable:

- `VITE_API_URL` — production backend origin for API requests (e.g.
  `https://nobryn.onrender.com`). Set this in the frontend hosting environment
  (Vercel) so the built frontend calls the deployed backend directly. The frontend
  never reads any backend secret.

For local development, leave `VITE_API_URL` unset. The client then sends relative
`/api/*` paths and the Vite dev server's `/api` proxy forwards them to the local
backend on `API_PORT` (default `4000`). The endpoint paths themselves
(`/api/auth/login`, `/api/transactions`, etc.) are unchanged in both modes — only
the base URL is configured.

Never put `DATABASE_URL`, `DATABASE_CA_CERT`, or `JWT_SECRET` into frontend
environment variables. Those belong only on the backend host.

### Frontend environment variable

```
VITE_API_URL=https://nobryn.onrender.com
```

- Required in production (Vercel build).
- Optional locally — unset means "use the Vite dev proxy".
- The only frontend environment variable Nobryn uses.
