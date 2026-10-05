import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
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
  const [transactions, setTransactions] = useState<TransactionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("ALL");
  const debounceRef = useRef<number | undefined>(undefined);

  const load = useCallback(async (opts: { search?: string; state?: string }) => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (opts.search) params.set("search", opts.search);
      if (opts.state && opts.state !== "ALL") params.set("state", opts.state);
      const qs = params.toString();
      const data = await api.get<TransactionListItem[]>(`/api/transactions${qs ? `?${qs}` : ""}`);
      setTransactions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }, []);

  useEffect(() => {
    void load({});
  }, [load]);

  function onSearchChange(value: string) {
    setSearch(value);
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void load({ search: value, state: stateFilter });
    }, 250);
  }

  function onStateFilterChange(value: string) {
    setStateFilter(value);
    void load({ search, state: value });
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

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px", maxWidth: 360 }}>
          <Input
            type="search"
            aria-label="Search transactions"
            placeholder="Search transactions"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div style={{ width: 180 }}>
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

      {error ? (
        <div className="card">
          <ErrorState
            title="Unable to load transactions"
            message="We couldn't retrieve your transactions from the transaction service."
            onRetry={() => void load({ search, state: stateFilter })}
          />
        </div>
      ) : transactions === null ? (
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
                    setStateFilter("ALL");
                    void load({});
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
