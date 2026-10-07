/**
 * Shared fetchers for endpoints that are requested from more than one place
 * (a page and a prefetch, for example). The cache key and the payload shape
 * must match exactly, otherwise a prefetch would warm a key the page never
 * reads — so they are defined once, here.
 *
 * Every other endpoint is fetched inline in its own page with the same string
 * it uses as the cache key.
 */
import { api } from "./api";
import type { OverviewData, TransactionDetail, TransactionListItem } from "./types";

export function fetchOverview(): Promise<OverviewData> {
  return api.get<OverviewData>("/api/overview");
}

export function fetchTransactionList(key: string): Promise<TransactionListItem[]> {
  return api.get<TransactionListItem[]>(key);
}

export function fetchTransactionDetail(id: string): Promise<TransactionDetail> {
  return api
    .get<{ transaction: TransactionDetail }>(`/api/transactions/${id}`)
    .then((res) => res.transaction);
}
