/**
 * Minimal client data layer: cache, request deduplication, background
 * revalidation (stale-while-revalidate), invalidation and prefetching.
 *
 * Why not a library: the app needs exactly this — one cache keyed by API
 * path, one in-flight request per key, and a way for mutations to invalidate
 * what they changed. React already gives us the subscription primitives, so a
 * small module keeps the dependency surface at zero.
 *
 * Lifecycle for a mounted query:
 *
 *   cache hit  → render cached data immediately (stale is fine)
 *   no cache   → render the loading state (the page shell still renders)
 *   always     → kick off a background revalidation (deduplicated per key)
 *   revalidate → fresh data replaces cached data, subscribers re-render
 *   mutation   → invalidate(keys…) marks the entries stale and re-runs them
 *   idle       → prefetch(key) warms the cache for a likely next destination
 *
 * Operational data (overview, transactions, exceptions, notifications) should
 * use the default `staleTime: 0` so every mount revalidates. Relatively stable
 * secondary data (counterparties, policies) can pass a larger `staleTime` so
 * it is served from cache and refreshed in the background.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface QueryEntry<T = unknown> {
  data?: T;
  error?: unknown;
  updatedAt: number;
  validating: boolean;
  promise?: Promise<T>;
}

const cache = new Map<string, QueryEntry>();
const listeners = new Map<string, Set<() => void>>();
const fetchers = new Map<string, () => Promise<unknown>>();

const RETRY_DELAY_MS = 600;

function entryFor(key: string): QueryEntry {
  let entry = cache.get(key);
  if (!entry) {
    entry = { updatedAt: 0, validating: false };
    cache.set(key, entry);
  }
  return entry;
}

function notify(key: string): void {
  const set = listeners.get(key);
  if (!set) return;
  for (const listener of [...set]) listener();
}

function subscribe(key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) listeners.delete(key);
  };
}

/** Network-level failures are retried once; HTTP errors surface immediately. */
async function fetchWithRetry<T>(fetcher: () => Promise<T>): Promise<T> {
  try {
    return await fetcher();
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    if (status !== 0) throw err;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return await fetcher();
  }
}

/**
 * Deduplicated revalidation: concurrent callers share one request, and a
 * cached value younger than `staleTime` is returned without a request.
 */
export function revalidate<T>(
  key: string,
  fetcher: () => Promise<T>,
  staleTime = 0
): Promise<T | undefined> {
  const entry = entryFor(key);
  if (entry.promise) return entry.promise as Promise<T | undefined>;
  if (entry.data !== undefined && Date.now() - entry.updatedAt < staleTime) {
    return Promise.resolve(entry.data as T);
  }

  entry.validating = true;
  notify(key);

  const pending = fetchWithRetry(fetcher)
    .then(
      (data) => {
        entry.data = data;
        entry.error = undefined;
        entry.updatedAt = Date.now();
        return data as T;
      },
      (error) => {
        entry.error = error;
        entry.updatedAt = Date.now();
        throw error;
      }
    )
    .finally(() => {
      entry.promise = undefined;
      entry.validating = false;
      notify(key);
    });

  entry.promise = pending;
  // Subscribers read the outcome from the entry; nothing else awaits this
  // promise, so swallow the rejection here to keep it from going unhandled.
  pending.catch(() => undefined);
  return pending as Promise<T | undefined>;
}

export interface UseQueryOptions {
  /** How long cached data is considered fresh. Default 0 (always revalidate). */
  staleTime?: number;
}

export interface QueryResult<T> {
  data: T | undefined;
  error: unknown;
  /** No data and no error yet — the page shell should show a skeleton. */
  loading: boolean;
  /** A request is in flight (including background revalidation). */
  isValidating: boolean;
  refetch: () => void;
}

/**
 * Subscribe to one cache key. The component renders cached data immediately
 * and revalidates in the background; unmounting never aborts a shared request.
 */
export function useQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: UseQueryOptions = {}
): QueryResult<T> {
  const staleTime = options.staleTime ?? 0;
  const [, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const staleTimeRef = useRef(staleTime);
  staleTimeRef.current = staleTime;

  useEffect(() => {
    if (!key) return undefined;
    const unsubscribe = subscribe(key, () => setTick((tick) => tick + 1));
    fetchers.set(key, () => fetcherRef.current());
    void revalidate(key, fetcherRef.current, staleTimeRef.current);
    return () => {
      unsubscribe();
    };
  }, [key]);

  const entry = key ? cache.get(key) : undefined;

  const refetch = useCallback(() => {
    if (!key) return;
    const current = entryFor(key);
    current.updatedAt = 0;
    const fetch = fetchers.get(key) ?? fetcherRef.current;
    void revalidate(key, fetch, 0);
  }, [key]);

  return {
    data: entry?.data as T | undefined,
    error: entry?.error,
    loading: !!key && entry?.data === undefined && entry?.error === undefined,
    isValidating: !!entry?.validating,
    refetch,
  };
}

/**
 * Mark matching cache keys stale and revalidate the ones currently on screen.
 * Keys that are not mounted stay marked stale and refresh on their next mount.
 *
 * Prefix matching is intentional: `invalidate("/api/transactions")` covers the
 * list, `?search=` variants and `/api/transactions/:id` details.
 */
export function invalidate(...prefixes: string[]): void {
  for (const key of [...cache.keys()]) {
    if (!prefixes.some((prefix) => key === prefix || key.startsWith(prefix))) continue;
    const entry = cache.get(key);
    if (!entry) continue;
    entry.updatedAt = 0;
    if (!listeners.has(key)) continue;
    const fetch = fetchers.get(key);
    if (fetch) void revalidate(key, fetch, 0);
  }
}

/**
 * Warm the cache for a likely next destination. Fire-and-forget: it never
 * blocks the current page, and it is a no-op when the data is already fresh
 * or a request for that key is already running.
 */
export function prefetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: UseQueryOptions = {}
): void {
  const staleTime = options.staleTime ?? 0;
  const entry = entryFor(key);
  if (entry.promise) return;
  if (entry.data !== undefined && Date.now() - entry.updatedAt < staleTime) return;
  fetchers.set(key, fetcher);
  void revalidate(key, fetcher, staleTime);
}

/**
 * Write a value straight into the cache (used after a mutation that returns
 * the authoritative updated entity, so the UI reflects the server response
 * without a refetch round trip).
 */
export function setQueryData<T>(key: string, data: T): void {
  const entry = entryFor(key);
  entry.data = data;
  entry.error = undefined;
  entry.updatedAt = Date.now();
  notify(key);
}

/**
 * Run `fn` when the browser is idle (or shortly after, as a fallback). */
export function onIdle(fn: () => void, timeout = 2000): () => void {
  const win = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof win.requestIdleCallback === "function") {
    const handle = win.requestIdleCallback(fn, { timeout });
    return () => win.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(fn, Math.min(timeout, 800));
  return () => window.clearTimeout(handle);
}
