/**
 * Rate-limit contract suite.
 *
 * Runs in its own process with a deliberately tiny quota so the assertions are
 * exact (MAX=3) and cannot interfere with the main E2E suite.
 *
 * Verifies:
 *   1. GET /health is public and needs no authentication
 *   2. GET /health performs no database query
 *   3. repeated GET /health requests are never rate limited
 *   4. repeated GET /health requests do not consume normal API quota
 *   5. other API endpoints (including auth) remain rate limited
 *   6. GET /health/deep is NOT exempt — it is rate limited
 *   7. 429 responses carry Retry-After and the normal `{ error }` shape
 *   8. the window resets, so clients recover without restarting
 */
import { bootstrapEnvironment, check, finish, startApi } from "./helpers.js";

process.env.API_PORT = process.env.API_PORT || "4601";
process.env.RATE_LIMIT_MAX = "3";
process.env.RATE_LIMIT_WINDOW_MS = "6000";
bootstrapEnvironment();

const { getDbOperations } = await import("../observability/metrics.js");

const base = await startApi();

const get = (path: string) => fetch(base + path);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Parsed response body — same convention as the E2E suite's `json: any`. */
async function body(res: Response): Promise<any> {
  return (await res.json()) as any;
}

// --- 1/2. public liveness, no database -------------------------------------
const health = await get("/health");
const healthJson = await body(health);
check("RL. GET /health is public (200, no auth header)", health.status === 200, health.status);
check(
  "RL. /health returns the liveness shape",
  healthJson.status === "ok" &&
    healthJson.service === "nobryn-api" &&
    typeof healthJson.timestamp === "string" &&
    typeof healthJson.uptime === "number",
  Object.keys(healthJson)
);

const dbBefore = getDbOperations().length;
const healthAgain = await get("/health");
const dbAfter = getDbOperations().length;
check(
  "RL. /health performs no database query",
  healthAgain.status === 200 && dbAfter === dbBefore,
  { status: healthAgain.status, queriesDuringRequest: dbAfter - dbBefore }
);

// --- deep diagnostics work and do query the database -----------------------
const deepBefore = getDbOperations().length;
const deep = await get("/health/deep");
const deepJson = await body(deep);
check(
  "RL. /health/deep reports database status and latency",
  deep.status === 200 &&
    deepJson.database?.status === "ok" &&
    typeof deepJson.database.latencyMs === "number" &&
    typeof deepJson.latencyMs === "number",
  deepJson
);
check(
  "RL. /health/deep performs a database query",
  getDbOperations().length > deepBefore,
  { queries: getDbOperations().length - deepBefore }
);

// --- 3/4. repeated /health requests are exempt -----------------------------
let healthOk = 0;
for (let i = 0; i < 10; i++) {
  const res = await get("/health");
  if (res.status === 200) healthOk += 1;
}
check("RL. 10 rapid /health requests are all accepted", healthOk === 10, healthOk);

// Quota so far (MAX=3): only /health/deep counted once above.
// --- 5. normal API endpoints stay reachable, then rate limited -------------
const overviewUnauth = await get("/api/overview");
check(
  "RL. unauthenticated API call is authorized-checked (401, not 429)",
  overviewUnauth.status === 401,
  overviewUnauth.status
);

const deepSecond = await get("/health/deep");
check(
  "RL. /health/deep still allowed inside quota (200)",
  deepSecond.status === 200,
  deepSecond.status
);

const deepThird = await get("/health/deep");
check(
  "RL. /health/deep is NOT exempt — rate limited with 429",
  deepThird.status === 429,
  deepThird.status
);
check(
  "RL. 429 carries Retry-After",
  Number(deepThird.headers.get("retry-after")) >= 1,
  deepThird.headers.get("retry-after")
);
const limitedBody = await body(deepThird);
check(
  "RL. 429 uses the normal error shape",
  typeof limitedBody.error === "string" && limitedBody.error.length > 0,
  limitedBody
);

const overviewLimited = await get("/api/overview");
check(
  "RL. other API endpoints remain rate limited (429)",
  overviewLimited.status === 429,
  overviewLimited.status
);

const loginLimited = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "a@b.co", password: "password123" }),
});
check(
  "RL. authentication endpoints remain rate limited (429)",
  loginLimited.status === 429,
  loginLimited.status
);

const healthWhileLimited = await get("/health");
check(
  "RL. /health still answers 200 while everything else is limited",
  healthWhileLimited.status === 200,
  healthWhileLimited.status
);

// --- 8. window resets without a restart ------------------------------------
await sleep(6500);
const recovered = await get("/api/overview");
check(
  "RL. quota recovers after the window (401 again, not 429)",
  recovered.status === 401,
  recovered.status
);

finish("Nobryn rate-limit suite");
