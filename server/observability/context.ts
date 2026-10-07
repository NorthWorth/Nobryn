import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request diagnostics context.
 *
 * Every HTTP request runs inside one of these stores, so any database call
 * made while handling that request can add its own duration to the store.
 * That is how the timing middleware can report `db=...` alongside `total=...`
 * without any route having to pass a timer around by hand.
 *
 * The store only exists for requests the instrumentation wrapped; scripts,
 * tests and background work simply have no store and record nothing.
 */
export interface RequestContext {
  dbMs: number;
  dbQueries: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function createRequestContext(): RequestContext {
  return { dbMs: 0, dbQueries: 0 };
}

/** Run `fn` with `store` bound to the current async flow. */
export function runWithRequestContext<T>(store: RequestContext, fn: () => T): T {
  return storage.run(store, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Called by the Prisma query hook after every database operation. */
export function recordDbOperation(ms: number): void {
  const store = storage.getStore();
  if (!store) return;
  store.dbMs += ms;
  store.dbQueries += 1;
}
