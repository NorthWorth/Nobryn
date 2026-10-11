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
import type {
  OverviewData,
  TransactionDetail,
  TransactionListItem,
  CommitmentRow,
  CommitmentProposalRow,
  AccessLinkRow,
  DeliveryPromptRow,
} from "./types";

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

export function fetchTransactionProposals(id: string) {
  return api.get<{ proposals: CommitmentProposalRow[] }>(`/api/transactions/${id}/proposals`);
}

export function fetchPendingProposal(id: string) {
  return api.get<{ proposal: CommitmentProposalRow | null }>(`/api/transactions/${id}/proposals/pending`);
}

export function fetchTransactionCommitment(id: string) {
  return api.get<{
    current: CommitmentRow | null;
    history: CommitmentRow[];
    pending: CommitmentProposalRow | null;
  }>(`/api/transactions/${id}/commitment`);
}

export function fetchAccessLinks(id: string) {
  return api.get<{ links: AccessLinkRow[] }>(`/api/transactions/${id}/access-links`);
}

export function fetchSupplierNote(id: string) {
  return api.get<{ note: string | null }>(`/api/transactions/${id}/supplier-note`);
}

export function fetchDueDeliveryPrompts() {
  return api.get<{ prompts: DeliveryPromptRow[] }>("/api/delivery-prompts/due");
}
