import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { formatMoney, formatRelative, formatDateTime } from "../lib/types";
import type { Summary, TransactionState } from "../lib/types";
import {
  EmptyState,
  ErrorState,
  ExceptionStatusBadge,
  Skeleton,
  SummarySkeleton,
  TableSkeleton,
  TransactionStateBadge,
} from "../components/ui";

export default function OverviewPage() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const summaryData = await api.get<Summary>("/api/summary");
      setSummary(summaryData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="content-max">
      <div className="page-header page-header-row">
        <div>
          <h1>Overview</h1>
          <p className="support">Monitor business transactions and resolve exceptions.</p>
        </div>
        <Link to="/app/transactions/new" className="btn btn-primary">
          Create transaction
        </Link>
      </div>

      {error ? (
        <div className="card">
          <ErrorState
            title="Unable to load overview"
            message="We couldn't retrieve your workspace data from the transaction service."
            onRetry={() => void load()}
          />
        </div>
      ) : loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          <SummarySkeleton />
          <TableSkeleton rows={5} cols={5} />
        </div>
      ) : summary ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          {/* Summary cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Active transactions" value={summary.cards.activeTransactions} />
            <SummaryCard label="Exceptions" value={summary.cards.exceptions} />
            <SummaryCard label="Completed" value={summary.cards.completed} />
            <SummaryCard label="Counterparties" value={summary.cards.counterparties} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Recent transactions */}
            <section className="lg:col-span-2" aria-label="Recent transactions">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
                <h2 className="section-heading" style={{ fontSize: 20 }}>Recent transactions</h2>
                <Link to="/app/transactions" className="text-12" style={{ color: "#2563EB", fontWeight: 500 }}>
                  View all
                </Link>
              </div>
              {summary.recentTransactions.length === 0 ? (
                <div className="card">
                  <EmptyState
                    title="No transactions"
                    description="Transactions will appear here when they are created."
                    action={
                      <Link to="/app/transactions/new" className="btn btn-primary">
                        Create transaction
                      </Link>
                    }
                  />
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="nbt">
                    <thead>
                      <tr>
                        <th>Transaction</th>
                        <th>Counterparty</th>
                        <th>Amount</th>
                        <th>State</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.recentTransactions.map((t) => (
                        <tr
                          key={t.id}
                          className="clickable"
                          tabIndex={0}
                          onClick={() => navigate(`/app/transactions/${t.id}`)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") navigate(`/app/transactions/${t.id}`);
                          }}
                        >
                          <td style={{ fontWeight: 500 }}>{t.purchaseOrderNumber}</td>
                          <td>{t.counterpartyName}</td>
                          <td className="mono">{formatMoney(t.amount, t.currency)}</td>
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
            </section>

            {/* Open exceptions */}
            <section aria-label="Open exceptions">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
                <h2 className="section-heading" style={{ fontSize: 20 }}>Open exceptions</h2>
                <Link to="/app/exceptions" className="text-12" style={{ color: "#2563EB", fontWeight: 500 }}>
                  View all
                </Link>
              </div>
              {summary.openExceptions.length === 0 ? (
                <div className="card">
                  <EmptyState
                    title="No open exceptions"
                    description="There are no transaction issues requiring attention."
                  />
                </div>
              ) : (
                <div className="card" style={{ overflow: "hidden" }}>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {summary.openExceptions.map((x, idx) => (
                      <li
                        key={x.id}
                        style={{
                          padding: "12px 16px",
                          borderBottom: idx < summary.openExceptions.length - 1 ? "1px solid #E2E8F0" : "none",
                        }}
                      >
                        <Link to={`/app/transactions/${x.transactionId}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 500 }}>
                              {exceptionLabel(x.type)}
                            </span>
                            <ExceptionStatusBadge status={x.status} />
                          </span>
                          <span className="text-12 text-muted">
                            {x.purchaseOrderNumber} · Detected {formatDateTime(x.detectedAt)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>

          {/* Transaction activity */}
          <section aria-label="Transaction activity">
            <h2 className="section-heading" style={{ marginBottom: 16 }}>
              Transaction activity
            </h2>
            <ActivityList />
          </section>
        </div>
      ) : null}
    </div>
  );
}

function exceptionLabel(type: string): string {
  switch (type) {
    case "SUPPLIER_TIMEOUT":
      return "Supplier timeout";
    case "DELIVERY_DELAY":
      return "Delivery delay";
    case "QUANTITY_MISMATCH":
      return "Quantity mismatch";
    default:
      return type;
  }
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card card-pad">
      <div className="text-12" style={{ color: "#64748B", fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, lineHeight: "36px", fontWeight: 600, marginTop: 4 }} className="mono">
        {value}
      </div>
    </div>
  );
}

/**
 * Activity feed built from the workspace's most recently updated transactions.
 */
function ActivityList() {
  const [rows, setRows] = useState<
    { id: string; description: string; createdAt: string; po: string; txId: string; state: TransactionState }[] | null
  >(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadActivity() {
      try {
        const transactions = await api.get<
          {
            id: string;
            purchaseOrderNumber: string;
            updatedAt: string;
            state: TransactionState;
            description: string;
          }[]
        >("/api/transactions");
        const base: typeof rows = transactions.slice(0, 8).map((t) => ({
          id: t.id,
          description: `Transaction ${t.state === "COMPLETED" ? "completed" : "updated"}`,
          createdAt: t.updatedAt,
          po: t.purchaseOrderNumber,
          txId: t.id,
          state: t.state,
        }));
        if (!cancelled) setRows(base);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    void loadActivity();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <div className="card">
        <ErrorState
          title="Unable to load activity"
          message="We couldn't retrieve recent transaction activity."
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} width={i % 2 ? "60%" : "45%"} height={14} />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="card">
        <EmptyState
          title="No activity yet"
          description="Activity will appear here as transactions progress."
        />
      </div>
    );
  }

  return (
    <div className="card">
      <ul style={{ listStyle: "none", margin: 0, padding: "8px 0" }}>
        {rows.map((row, idx) => (
          <li
            key={`${row.id}-${idx}`}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "10px 24px",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: 9999,
                background: "#CBD5E1",
                marginTop: 7,
                flex: "none",
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <Link to={`/app/transactions/${row.txId}`} style={{ fontWeight: 500 }}>
                  {row.po}
                </Link>
                <span className="text-12 text-subtle">{formatDateTime(row.createdAt)}</span>
              </div>
              <div className="text-12 text-muted">{row.description}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
