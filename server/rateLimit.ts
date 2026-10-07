import type { NextFunction, Request, Response } from "express";

/**
 * Fixed-window rate limiter for the Nobryn API.
 *
 * Scope: every route except exactly one — `GET /health`.
 *
 *   GET /health       → public, never rate limited (future external monitor)
 *   GET /health/deep  → rate limited like everything else
 *   /api/**           → rate limited (auth, transactions, mutations, integrations)
 *
 * The exemption is deliberately an explicit allow-list of one method+path, so
 * it cannot silently widen: `/health/deep` and `/api/health` are counted
 * normally. Because `/health` bypasses the limiter it must stay computationally
 * trivial — no database access, no Prisma, no application data (see
 * routes/health.ts).
 *
 * The counter is per client IP (fixed window, in-memory, no external store).
 * `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` configure it per environment.
 */

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX || 300);

/** Bound on tracked addresses so a flood of unique IPs cannot grow memory. */
const MAX_TRACKED_KEYS = 20_000;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * The single exempt route: public liveness for the future external monitor.
 * `req.path` here is the full request path (`/health`, `/health/deep`, …).
 */
export function isRateLimitExempt(req: Request): boolean {
  return req.method === "GET" && req.path === "/health";
}

/** Drop expired buckets so memory tracks active clients only. */
const sweep = setInterval(
  () => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  },
  Math.max(WINDOW_MS, 30_000)
);
sweep.unref?.();

export function rateLimit(options: { windowMs?: number; max?: number } = {}) {
  const windowMs = options.windowMs ?? WINDOW_MS;
  const max = options.max ?? MAX_REQUESTS;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (isRateLimitExempt(req)) {
      next();
      return;
    }

    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      // Fail open if an attacker floods from unbounded unique addresses:
      // availability beats strictness for a small application.
      if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    if (bucket.count >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        error: "Too many requests. Please try again in a moment.",
      });
      return;
    }

    bucket.count += 1;
    next();
  };
}

/** Test helper: clear all counters (used by the rate-limit suite). */
export function resetRateLimit(): void {
  buckets.clear();
}
