import { Router } from "express";
import { prisma } from "../prisma.js";
import { asyncHandler } from "../errors.js";
import { checkDatabase } from "../observability/database.js";
import {
  recordDbCheck,
  BUILD,
  SERVICE_NAME,
  VERSION,
} from "../observability/metrics.js";

/**
 * Health endpoints for external monitoring.
 *
 * FUTURE MONITORING CONFIGURATION (not configured yet — no monitoring
 * provider is wired up, and none is required until one is chosen):
 *
 *   Monitor:  https://nobryn.onrender.com/health
 *   Method:   GET
 *   Expect:   HTTP 200
 *   Interval: 5–10 minutes (the Render free tier sleeps after inactivity, so
 *             the first probe may be a cold start — expect it to be slower,
 *             never to fail)
 *
 * Both endpoints are intentionally public and unauthenticated: an external
 * monitor must be able to read UP/DOWN without credentials. They therefore
 * expose only operational metadata — never DATABASE_URL, credentials, JWT
 * secrets, certificates or any other environment value.
 *
 * Related, authenticated endpoint for Nobryn's own dashboard:
 *   GET /api/observability  (see routes/observability.ts)
 */

const startedAt = Date.now();

function baseHealth() {
  return {
    status: "ok" as const,
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    uptime: Math.round((Date.now() - startedAt) / 1000),
    version: VERSION,
    ...(BUILD ? { build: BUILD } : {}),
  };
}

export const healthRouter = Router();

/**
 * Extremely lightweight liveness probe. No database access, no application
 * queries: it only proves the process is alive and Express can produce a
 * valid response. Safe to poll as often as a monitor likes.
 */
healthRouter.get("/health", (_req, res) => {
  res.status(200).json(baseHealth());
});

/**
 * Deeper diagnostic probe for internal use and the observability dashboard:
 * adds a real PostgreSQL round trip (latency + reachability) and the overall
 * diagnostic duration. A database outage yields HTTP 503 with a `degraded`
 * status while still returning useful diagnostics.
 */
healthRouter.get(
  "/health/deep",
  asyncHandler(async (_req, res) => {
    const started = performance.now();
    const database = await checkDatabase(() => prisma.$queryRaw`SELECT 1`);
    const latencyMs = Math.round(performance.now() - started);

    recordDbCheck({
      status: database.status,
      latencyMs: database.latencyMs,
      at: new Date().toISOString(),
    });

    res.status(database.status === "ok" ? 200 : 503).json({
      ...baseHealth(),
      status: database.status === "ok" ? "ok" : "degraded",
      database,
      latencyMs,
    });
  })
);
