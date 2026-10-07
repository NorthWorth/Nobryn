import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchTransactionDetail, fetchTransactionList } from "../lib/endpoints";
import { prefetch, useQuery } from "../lib/query";
import { formatMoney, formatRelative, formatDate } from "../lib/types";
import type { TransactionListItem } from "../lib/types";
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  Select,
  TableSkeleton,
  TransactionStateBadge,
} from "../components/ui";

const STATE_FILTERS: { value: string; label: string }[] = [
  { value: "ALL", label: "All states" },
  { value: "CREATED", label: "Created" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "FULFILLING", label: "Fulfilling" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "COMPLETED", label: "Completed" },
];

export default function TransactionsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("ALL");
  const debounceRef = useRef<number | undefined>(undefined);

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(debounceRef.current);
  }, [search]);

  const key = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (stateFilter !== "ALL") params.set("state", stateFilter);
    const qs = params.toString();
    return `/api/transactions${qs ? `?${qs}` : ""}`;
  }, [debouncedSearch, stateFilter]);

  // One cached request per filter combination: switching back to a previous
  // filter paints instantly from cache and revalidates in the background.
  const { data: transactions, error, refetch } = useQuery<TransactionListItem[]>(key, () =>
    fetchTransactionList(key)
  );

  function onStateFilterChange(value: string) {
    setStateFilter(value);
  }

  /** Prefetch a transaction's detail when the user shows intent (hover/focus). */
  function previewTransaction(id: string) {
    prefetch(`/api/transactions/${id}`, () => fetchTransactionDetail(id));
  }

  const filtered = useMemo(() => transactions ?? [], [transactions]);

  return (
    <div className="content-max" style={{ maxWidth: "none" }}>
      <div className="page-header page-header-row">
        <div>
          <h1>Transactions</h1>
          <p className="support">
            Track and execute business transactions from creation to completion.
          </p>
        </div>
        <Link to="/app/transactions/new" className="btn btn-primary">
          Create transaction
        </Link>
      </div>

      <div className="toolbar">
        <div className="toolbar-search">
          <Input
            type="search"
            aria-label="Search transactions"
            placeholder="Search transactions"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="toolbar-filter">
          <Select
            aria-label="Filter by state"
            value={stateFilter}
            onChange={(e) => onStateFilterChange(e.target.value)}
          >
            {STATE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error && !transactions ? (
        <div className="card">
          <ErrorState
            title="Unable to load transactions"
            message="We couldn't retrieve your transactions from the transaction service."
            onRetry={refetch}
          />
        </div>
      ) : !transactions ? (
        <TableSkeleton rows={7} cols={6} />
      ) : filtered.length === 0 ? (
        <div className="card">
          {search || stateFilter !== "ALL" ? (
            <EmptyState
              title="No matching transactions"
              description="No transactions match the current search and filters."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setDebouncedSearch("");
                    setStateFilter("ALL");
                  }}
                >
                  Clear search and filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No transactions"
              description="Transactions will appear here when they are created."
              action={
                <Link to="/app/transactions/new" className="btn btn-primary">
                  Create transaction
                </Link>
              }
            />
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="nbt">
            <thead>
              <tr>
                <th>Transaction</th>
                <th>Counterparty</th>
                <th>Amount</th>
                <th>Expected delivery</th>
                <th>State</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr
                  key={t.id}
                  className="clickable"
                  tabIndex={0}
                  aria-label={`Open transaction ${t.purchaseOrderNumber}`}
                  onClick={() => navigate(`/app/transactions/${t.id}`)}
                  onMouseEnter={() => previewTransaction(t.id)}
                  onFocus={() => previewTransaction(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") navigate(`/app/transactions/${t.id}`);
                  }}
                >
                  <td>
                    <div style={{ fontWeight: 500 }}>{t.purchaseOrderNumber}</div>
                    <div className="secondary" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.description}
                    </div>
                  </td>
                  <td>{t.counterpartyName}</td>
                  <td className="mono">{formatMoney(t.amount, t.currency)}</td>
                  <td className="text-12 text-muted">{formatDate(t.expectedDeliveryDate)}</td>
                  <td>
                    <TransactionStateBadge state={t.state} />
                  </td>
                  <td className="text-12 text-muted">{formatRelative(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
