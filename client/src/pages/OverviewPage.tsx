import { Fragment, useEffect } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { onIdle, prefetch, useQuery } from "../lib/query";
import { formatMoney, formatRelative, formatDateTime, STATE_LABELS } from "../lib/types";
import type { OverviewData, TransactionListItem, TransactionState } from "../lib/types";
import {
  CardSkeleton,
  EmptyState,
  ErrorState,
  ExceptionStatusBadge,
  SeverityBadge,
  Skeleton,
  SummarySkeleton,
  TableSkeleton,
  TransactionStateBadge,
} from "../components/ui";

export default function OverviewPage() {
  const navigate = useNavigate();

  // One page-level request for every Overview section. The shell (header,
  // section headings, card/table structure) renders immediately; each section
  // shows its own skeleton until the response lands.
  const { data: summary, error, loading, refetch } = useQuery<OverviewData>(
    "/api/overview",
    () => api.get<OverviewData>("/api/overview")
  );

  // Targeted prefetch: once Overview has data, warm the Transactions list in
  // the background while the browser is idle. It never blocks this page.
  useEffect(() => {
    if (!summary) return undefined;
    return onIdle(() => {
      prefetch("/api/transactions", () => api.get<TransactionListItem[]>("/api/transactions"));
    });
  }, [summary]);

  return (
    <div className="content-max">
      <div className="page-header page-header-row ov-header">
        <div>
          <h1>Overview</h1>
          <p className="support">Monitor business transactions and resolve exceptions.</p>
        </div>
        <Link to="/app/transactions/new" className="btn btn-primary">
          Create transaction
        </Link>
      </div>

      {error && !summary ? (
        <div className="card">
          <ErrorState
            title="Unable to load overview"
            message={
              error instanceof Error
                ? error.message
                : "We couldn't retrieve your workspace data from the transaction service."
            }
            onRetry={refetch}
          />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          {/* Metric composition: one primary metric, three supporting metrics.
              Skeleton first, so the page never waits on data to show shape. */}
          {summary ? <MetricSection summary={summary} /> : <SummarySkeleton />}

          {/* Action required — things that need human attention now. This
              section only exists when there is work to do, so it appears as
              soon as the response arrives rather than showing an empty shell. */}
          {summary && summary.actionRequired.length > 0 ? (
            <section aria-label="Action required">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 16,
                  gap: 8,
                }}
              >
                <h2 className="section-heading" style={{ fontSize: 20 }}>
                  Action required
                </h2>
                <span className="text-12 text-muted">
                  {summary.actionRequired.length} open
                </span>
              </div>
              <div className="card" style={{ overflow: "hidden" }}>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {summary.actionRequired.map((item, idx) => (
                    <li
                      key={item.id}
                      style={{
                        padding: "16px 24px",
                        borderBottom:
                          idx < summary.actionRequired.length - 1
                            ? "1px solid #D9E0DC"
                            : "none",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
                        >
                          <span style={{ fontSize: 14, fontWeight: 600 }} className="mono">
                            {item.purchaseOrderNumber}
                          </span>
                          <SeverityBadge severity={item.severity} />
                        </span>
                        <span className="text-12 text-subtle">
                          {formatDateTime(item.detectedAt)}
                        </span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 500, marginTop: 6 }}>
                        {item.title}
                      </div>
                      <div style={{ fontSize: 13, color: "#647067", marginTop: 2 }}>
                        {item.description}
                      </div>
                      <div className="text-12 text-muted" style={{ marginTop: 2 }}>
                        {item.why}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                          alignItems: "center",
                          marginTop: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
                        >
                          <span className="badge badge-neutral">
                            <span className="dot" aria-hidden />
                            {item.status}
                          </span>
                          <span className="text-12 text-muted">
                            Next: {item.nextAction}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => navigate(item.targetPath)}
                        >
                          {item.kind === "EXCEPTION"
                            ? "Resolve exception"
                            : item.kind === "EVENT"
                              ? "Review event"
                              : "Review transaction"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Recent transactions */}
            <section className="lg:col-span-2" aria-label="Recent transactions">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
                <h2 className="section-heading" style={{ fontSize: 20 }}>Recent transactions</h2>
                <Link to="/app/transactions" className="text-12" style={{ color: "var(--ink)", fontWeight: 500 }}>
                  View all
                </Link>
              </div>
              {loading ? (
                <TableSkeleton rows={3} cols={5} />
              ) : !summary || summary.recentTransactions.length === 0 ? (
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
                <Link to="/app/exceptions" className="text-12" style={{ color: "var(--ink)", fontWeight: 500 }}>
                  View all
                </Link>
              </div>
              {loading ? (
                <CardSkeleton lines={3} />
              ) : !summary || summary.openExceptions.length === 0 ? (
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
                          borderBottom: idx < summary.openExceptions.length - 1 ? "1px solid #D9E0DC" : "none",
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
            <ActivityList rows={summary ? summary.recentActivity : null} />
          </section>
        </div>
      )}
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

/**
 * Metric composition: Active transactions is the dominant operational metric;
 * Exceptions, Completed and Counterparties are compact supporting metrics.
 * All counts come straight from the summary response — nothing is hardcoded.
 */
function MetricSection({ summary }: { summary: OverviewData }) {
  const activeCount = summary.cards.activeTransactions;

  // The active transactions visible in the recent list (the summary endpoint
  // returns the five most recently updated transactions with their state).
  const activeRecent = summary.recentTransactions.filter((t) => t.state !== "COMPLETED");
  const groups: { state: TransactionState; count: number }[] = [];
  for (const t of activeRecent) {
    const group = groups.find((g) => g.state === t.state);
    if (group) group.count += 1;
    else groups.push({ state: t.state, count: 1 });
  }

  // Feature a single active transaction only when exactly one exists and it is
  // visible in the data — never fabricate a reference.
  const featured = activeCount === 1 && activeRecent.length === 1 ? activeRecent[0] : null;
  const fullyObserved = activeRecent.length === activeCount;

  let stateSummary: ReactNode = null;
  if (activeCount > 0) {
    if (activeRecent.length === 0) {
      stateSummary = <>{activeCount} in progress</>;
    } else if (groups.length === 1 && fullyObserved) {
      const g = groups[0];
      stateSummary = (
        <>
          <span className="ov-state-name">{STATE_LABELS[g.state]}</span>
          {" \u00b7 "}
          {g.count} transaction{g.count === 1 ? "" : "s"}
        </>
      );
    } else {
      const remainder = activeCount - activeRecent.length;
      stateSummary = (
        <>
          {groups.map((g, i) => (
            <Fragment key={g.state}>
              {i > 0 ? " \u00b7 " : ""}
              <span className="ov-state-name">{STATE_LABELS[g.state]}</span> {g.count}
            </Fragment>
          ))}
          {remainder > 0 ? ` \u00b7 +${remainder} more` : ""}
        </>
      );
    }
  }

  return (
    <section aria-label="Key metrics" className="ov-metrics">
      {/* Primary metric */}
      <div className="ov-primary">
        <div className="ov-primary-top">
          <span className="ov-primary-label">Active transactions</span>
          {activeCount > 0 ? (
            <span className="ov-primary-state">
              <span className="ov-state-dot" aria-hidden />
              <span>{stateSummary}</span>
            </span>
          ) : null}
        </div>
        <div className="ov-primary-body">
          <span className="ov-primary-value mono">{activeCount}</span>
          <div className="ov-primary-copy">
            <p className="ov-primary-support">
              {activeCount > 0
                ? "Currently moving through the transaction lifecycle"
                : "No transactions currently in progress"}
            </p>
          </div>
        </div>
        {featured ? (
          <Link to={`/app/transactions/${featured.id}`} className="ov-primary-featured">
            <span className="ov-featured-po mono">{featured.purchaseOrderNumber}</span>
            <span className="ov-featured-cta">View transaction →</span>
          </Link>
        ) : null}
      </div>

      {/* Supporting metrics */}
      <div className="ov-secondary">
        <MetricCard
          label="Exceptions"
          value={summary.cards.exceptions}
          support="Open exceptions"
        />
        <MetricCard
          label="Completed"
          value={summary.cards.completed}
          support="Completed transactions to date"
        />
        <MetricCard
          label="Counterparties"
          value={summary.cards.counterparties}
          support="Counterparties on record"
        />
      </div>
    </section>
  );
}

function MetricCard({ label, value, support }: { label: string; value: number; support: string }) {
  return (
    <div className="ov-metric">
      <div className="ov-metric-label">{label}</div>
      <div className="ov-metric-value mono">{value}</div>
      <div className="ov-metric-support">{support}</div>
    </div>
  );
}

/**
 * Activity feed built from the workspace's most recently updated transactions.
 * Rows arrive with the page-level Overview response, so this makes no request
 * of its own; `null` means "still loading" and keeps the card's dimensions.
 */
function ActivityList({ rows }: { rows: OverviewData["recentActivity"] | null }) {
  const items = rows
    ? rows.map((row) => ({
        id: row.id,
        txId: row.id,
        po: row.purchaseOrderNumber,
        createdAt: row.updatedAt,
        description: `Transaction ${row.state === "COMPLETED" ? "completed" : "updated"}`,
        state: row.state,
      }))
    : null;

  if (!items) {
    return (
      <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} width={i % 2 ? "60%" : "45%"} height={14} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
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
        {items.map((row, idx) => (
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
                background: "#D9E0DC",
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
