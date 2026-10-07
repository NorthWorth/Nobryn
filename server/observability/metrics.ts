import fs from "node:fs";

/**
 * In-memory request/latency metrics.
 *
 * Deliberately small: a few bounded buffers plus running aggregates, so the
 * API can report health and latency to the Nobryn dashboard (and to a future
 * external monitor) without introducing a metrics database, an agent or a
 * third-party dependency. Everything is per-process and resets on restart —
 * which is exactly what a free-tier Render instance does when it sleeps.
 *
 * Nothing sensitive is stored: only method, pathname (never the query
 * string), status code and durations.
 */

export interface RequestSample {
  method: string;
  path: string;
  status: number;
  totalMs: number;
  dbMs: number;
  dbQueries: number;
  at: string;
}

export interface DbCheck {
  status: "ok" | "error" | "timeout";
  latencyMs: number;
  at: string;
}

/**
 * One sampled database operation. Durations are useful without any of the
 * data: only the Prisma model, the operation name and how long it took.
 */
export interface DbOperationSample {
  model: string;
  operation: string;
  ms: number;
  at: string;
}

export interface RouteAggregate {
  path: string;
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
  dbMs: number;
}

const RECENT_LIMIT = 120;
const SLOW_LIMIT = 20;
const FAILURE_LIMIT = 20;
const ROUTE_LIMIT = 40;
const DB_OPERATION_LIMIT = 100;

/** Requests slower than this are always reported as slow operations. */
const SLOW_THRESHOLD_MS = Number(process.env.METRICS_SLOW_MS || 500);

/** Database operations slower than this are reported as slow queries. */
export const SLOW_QUERY_MS = Number(process.env.METRICS_SLOW_QUERY_MS || 100);

const recent: RequestSample[] = [];
const slowOperations: RequestSample[] = [];
const recentFailures: RequestSample[] = [];
const dbOperations: DbOperationSample[] = [];
const routes = new Map<string, RouteAggregate>();

let requestCount = 0;
let errorCount = 0;
let totalMsSum = 0;
let dbMsSum = 0;
let dbQueryCount = 0;
let lastRequestAt: string | null = null;
let lastDbCheck: DbCheck | null = null;
const startedAt = Date.now();

function pushCapped<T>(list: T[], item: T, limit: number): void {
  list.push(item);
  if (list.length > limit) list.splice(0, list.length - limit);
}

export function recordRequest(sample: RequestSample): void {
  requestCount += 1;
  totalMsSum += sample.totalMs;
  dbMsSum += sample.dbMs;
  dbQueryCount += sample.dbQueries;
  lastRequestAt = sample.at;

  if (sample.status >= 500) errorCount += 1;

  pushCapped(recent, sample, RECENT_LIMIT);

  if (sample.totalMs >= SLOW_THRESHOLD_MS) {
    pushCapped(slowOperations, sample, SLOW_LIMIT);
    slowOperations.sort((a, b) => b.totalMs - a.totalMs);
  }
  if (sample.status >= 400) {
    pushCapped(recentFailures, sample, FAILURE_LIMIT);
    recentFailures.sort((a, b) => b.at.localeCompare(a.at));
  }

  const existing = routes.get(sample.path);
  if (existing) {
    existing.count += 1;
    existing.totalMs += sample.totalMs;
    existing.dbMs += sample.dbMs;
    existing.maxMs = Math.max(existing.maxMs, sample.totalMs);
    if (sample.status >= 500) existing.errors += 1;
    return;
  }
  if (routes.size >= ROUTE_LIMIT) return;
  routes.set(sample.path, {
    path: sample.path,
    count: 1,
    errors: sample.status >= 500 ? 1 : 0,
    totalMs: sample.totalMs,
    maxMs: sample.totalMs,
    dbMs: sample.dbMs,
  });
}

export function recordDbCheck(check: DbCheck): void {
  lastDbCheck = check;
}

/** Called by the Prisma query hook for every database operation. */
export function recordDbOperation(op: DbOperationSample): void {
  pushCapped(dbOperations, op, DB_OPERATION_LIMIT);
}

export function getDbOperations(): DbOperationSample[] {
  return [...dbOperations].reverse();
}

export function getDbCheck(): DbCheck | null {
  return lastDbCheck;
}

/** Percentile of a numeric sample set (0–100). Returns 0 for an empty set. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return Math.round(sorted[index]);
}

export interface MetricsSnapshot {
  service: string;
  version: string;
  build: string | null;
  startedAt: string;
  timestamp: string;
  uptimeSeconds: number;
  api: {
    status: "ok" | "degraded";
    requests: number;
    errors: number;
    errorRatePercent: number;
    requestsInWindow: number;
    lastRequestAt: string | null;
  };
  database: {
    status: "ok" | "error" | "timeout" | "unknown";
    latencyMs: number | null;
    lastCheckedAt: string | null;
  };
  latency: {
    windowSamples: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    avgMs: number;
    avgDbMs: number;
    avgDbQueries: number;
  };
  routes: RouteAggregate[];
  slowOperations: RequestSample[];
  recentRequests: RequestSample[];
  recentFailures: RequestSample[];
  databaseOperations: {
    slow: DbOperationSample[];
    recent: DbOperationSample[];
  };
}

/** Package version, read defensively (source tree vs. compiled `dist/`). */
function readVersion(): string {
  const candidates = ["../package.json", "../../package.json"];
  for (const rel of candidates) {
    try {
      const raw = fs.readFileSync(new URL(rel, import.meta.url), "utf8");
      const parsed = JSON.parse(raw) as { version?: string };
      if (parsed.version) return parsed.version;
    } catch {
      /* try the next candidate */
    }
  }
  return process.env.npm_package_version || "0.0.0";
}

export const SERVICE_NAME = "nobryn-api";
export const VERSION = readVersion();
export const BUILD =
  process.env.RENDER_GIT_COMMIT ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GIT_COMMIT ||
  null;

export function uptimeSeconds(): number {
  return Math.round((Date.now() - startedAt) / 1000);
}

export function getSnapshot(): MetricsSnapshot {
  const windowSamples = recent.map((r) => r.totalMs);
  const windowDb = recent.map((r) => r.dbMs);
  const windowQueries = recent.map((r) => r.dbQueries);
  const windowErrors = recent.filter((r) => r.status >= 500).length;
  const avg = (values: number[]) =>
    values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;

  const routeList = [...routes.values()]
    .map((r) => ({ ...r, totalMs: Math.round(r.totalMs), dbMs: Math.round(r.dbMs) }))
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 12);

  return {
    service: SERVICE_NAME,
    version: VERSION,
    build: BUILD,
    startedAt: new Date(startedAt).toISOString(),
    timestamp: new Date().toISOString(),
    uptimeSeconds: uptimeSeconds(),
    api: {
      // Degraded when more than 5% of the observed window failed server-side.
      status:
        recent.length >= 10 && windowErrors / recent.length > 0.05 ? "degraded" : "ok",
      requests: requestCount,
      errors: errorCount,
      errorRatePercent:
        requestCount === 0
          ? 0
          : Math.round((errorCount / requestCount) * 1000) / 10,
      requestsInWindow: recent.length,
      lastRequestAt,
    },
    database: {
      status: lastDbCheck?.status ?? "unknown",
      latencyMs: lastDbCheck?.latencyMs ?? null,
      lastCheckedAt: lastDbCheck?.at ?? null,
    },
    latency: {
      windowSamples: recent.length,
      p50Ms: percentile(windowSamples, 50),
      p95Ms: percentile(windowSamples, 95),
      maxMs: windowSamples.length ? Math.max(...windowSamples) : 0,
      avgMs: avg(windowSamples),
      avgDbMs: avg(windowDb),
      avgDbQueries: avg(windowQueries),
    },
    routes: routeList,
    slowOperations: slowOperations.slice(0, 10),
    recentRequests: [...recent].reverse().slice(0, 20),
    recentFailures: recentFailures.slice(0, 10),
    databaseOperations: {
      slow: getDbOperations()
        .filter((op) => op.ms >= SLOW_QUERY_MS)
        .slice(0, 10),
      recent: getDbOperations().slice(0, 10),
    },
  };
}
