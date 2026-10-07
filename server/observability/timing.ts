import type { NextFunction, Request, Response } from "express";
import { createRequestContext, runWithRequestContext } from "./context.js";
import { recordRequest, type RequestSample } from "./metrics.js";

/**
 * Request timing instrumentation.
 *
 * One middleware for the whole API: it wraps every request in a diagnostics
 * context (so Prisma operations can add their own duration), then records and
 * logs the outcome when the response finishes:
 *
 *   [nobryn] GET /api/overview status=200 total=7421ms db=6810ms queries=14
 *
 * Logging is pathname-only (never the query string), and neither request
 * bodies nor headers are read, so no token, password or database URL can end
 * up in the log stream.
 *
 * Health endpoints are measured (so `/health/deep` can report its own
 * latency) but are excluded from metrics and logs: a future monitor polling
 * every 30s must not distort the API's own latency statistics.
 */

const SKIP_PATHS = new Set(["/health", "/health/deep", "/api/health"]);

/** Strip the query string so no parameter value is ever logged or stored. */
function pathnameOf(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

export function requestTiming() {
  return (req: Request, res: Response, next: NextFunction): void => {    const path = pathnameOf(req.originalUrl || req.url);
    const started = performance.now();
    const store = createRequestContext();

    runWithRequestContext(store, () => {
      res.on("finish", () => {
        const totalMs = Math.round(performance.now() - started);
        const dbMs = Math.round(store.dbMs);
        const dbQueries = store.dbQueries;


        if (!SKIP_PATHS.has(path)) {
          const sample: RequestSample = {
            method: req.method,
            path,
            status: res.statusCode,
            totalMs,
            dbMs,
            dbQueries,
            at: new Date().toISOString(),
          };
          recordRequest(sample);
          console.log(
            `[nobryn] ${req.method} ${path} status=${res.statusCode} total=${totalMs}ms db=${dbMs}ms queries=${dbQueries}`
          );
        }
      });
      next();
    });
  };
}
