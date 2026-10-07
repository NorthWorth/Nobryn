import { Router } from "express";
import { prisma } from "../prisma.js";
import { asyncHandler } from "../errors.js";
import { checkDatabase } from "../observability/database.js";
import {
  getSnapshot,
  recordDbCheck,
  BUILD,
  SERVICE_NAME,
  VERSION,
  uptimeSeconds,
} from "../observability/metrics.js";

/**
 * GET /api/observability — the health/performance snapshot consumed by
 * Nobryn's internal operational dashboard.
 *
 * Mounted behind the workspace auth stack (see routes/api.ts), so it is only
 * available to signed-in users. External monitors must use the public,
 * unauthenticated `GET /health` endpoint instead.
 *
 * Everything here is produced by the in-process metrics store: API status,
 * database status and round-trip latency, recent latency percentiles, slow
 * operations, error rate and recent failures. No secrets, no query strings,
 * no request bodies.
 */
export const observabilityRouter = Router();

observabilityRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const database = await checkDatabase(() => prisma.$queryRaw`SELECT 1`);
    recordDbCheck({
      status: database.status,
      latencyMs: database.latencyMs,
      at: new Date().toISOString(),
    });

    const snapshot = getSnapshot();
    res.json({
      ...snapshot,
      // Keep the dashboard's vocabulary aligned with /health/deep.
      database: { ...snapshot.database, ...database },
      health: {
        status: database.status === "ok" ? "ok" : "degraded",
        service: SERVICE_NAME,
        version: VERSION,
        build: BUILD,
        uptime: uptimeSeconds(),
        timestamp: new Date().toISOString(),
      },
    });
  })
);
