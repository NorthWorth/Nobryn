import express from "express";
import cors from "cors";
import "./env.js";
import { errorHandler } from "./errors.js";
import { authRouter } from "./routes/auth.js";
import { apiRouter } from "./routes/api.js";
import { healthRouter } from "./routes/health.js";
import { requestTiming } from "./observability/timing.js";
import { rateLimit } from "./rateLimit.js";

const app = express();
app.disable("x-powered-by");

// One proxy hop in front (Render/Vercel edge): lets `req.ip` — and therefore
// the rate limiter's per-client counters — use the real client address from
// X-Forwarded-For instead of the proxy's address (which every client shares).
app.set("trust proxy", 1);

// Lightweight timing instrumentation for every request: records duration and
// database time per route and logs slow/normal API calls (health probes are
// measured but excluded from metrics and logs).
app.use(requestTiming());

// Rate limit: everything except the public `GET /health` liveness endpoint
// (see rateLimit.ts). Runs before body parsing so rejected requests are cheap.
app.use(rateLimit());

app.use(express.json({ limit: "1mb" }));

const corsOrigin = process.env.CORS_ORIGIN;
if (corsOrigin) {
  app.use(cors({ origin: corsOrigin.split(",").map((s) => s.trim()) }));
} else {
  app.use(cors());
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "nobryn-api" });
});

// Public health endpoints (no auth): `GET /health` for the future external
// monitor, `GET /health/deep` for internal diagnostics. See routes/health.ts.
app.use(healthRouter);

app.use("/api/auth", authRouter);
app.use("/api", apiRouter);

// 404 for unknown API routes.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use(errorHandler);

// The API binds to its own port: API_PORT when running alongside the Vite dev
// server (which owns PORT in managed previews), otherwise PORT (production).
const port = Number(process.env.API_PORT || process.env.PORT || 4000);
app.listen(port, "0.0.0.0", () => {
  console.log(`[nobryn] API listening on http://0.0.0.0:${port}`);
});
