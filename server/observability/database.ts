/**
 * Database reachability probe shared by `/health/deep` and the observability
 * snapshot: one `SELECT 1` round trip with a hard timeout.
 *
 * Errors are reduced to a stable, non-sensitive code (Prisma's error code when
 * available). The raw message is logged server-side but never returned to a
 * caller, because database driver messages can contain the database host.
 */

export interface DbDiagnostic {
  status: "ok" | "error" | "timeout";
  latencyMs: number;
  error?: string;
}

const DB_TIMEOUT_MS = Number(process.env.HEALTH_DB_TIMEOUT_MS || 5000);

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function checkDatabase(
  query: () => Promise<unknown>
): Promise<DbDiagnostic> {
  const started = performance.now();
  try {
    await withTimeout(query(), DB_TIMEOUT_MS);
    return { status: "ok", latencyMs: Math.round(performance.now() - started) };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const timedOut = err instanceof TimeoutError;
    const code =
      !timedOut && err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : undefined;
    console.error(
      `[nobryn] database health check failed (${timedOut ? "timeout" : "error"}):`,
      err
    );
    return {
      status: timedOut ? "timeout" : "error",
      latencyMs,
      error: timedOut ? "TIMEOUT" : code || "UNAVAILABLE",
    };
  }
}
