import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiClientError } from "../lib/api";
import {
  EVENT_SOURCE_GROUPS,
  EXCEPTION_LABELS,
  STATE_LABELS,
  formatDateTime,
  formatMoney,
  formatDate,
  formatRelative,
} from "../lib/types";
import type {
  ActivityCategory,
  SimulatedEventOption,
  TransactionDetail,
} from "../lib/types";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import {
  Button,
  EmptyState,
  ErrorState,
  ExceptionStatusBadge,
  Input,
  Modal,
  SeverityBadge,
  Skeleton,
  Textarea,
  TransactionStateBadge,
} from "../components/ui";
import { TransactionStateTimeline } from "../components/TransactionStateTimeline";

/**
 * Audit-trail category colors — Nobryn palette tokens. Structural categories
 * stay neutral (Bio Black family), semantic categories keep their meaning
 * (verification/completion green, exception red, claim informational blue).
 */
const CATEGORY_COLOR: Record<ActivityCategory, string> = {
  CLAIM: "#1D4ED8",
  VERIFICATION: "#15803D",
  RECONCILIATION: "#06110D",
  "STATE CHANGE": "#647067",
  EXCEPTION: "#B91C1C",
  EXECUTION: "#8E9892",
  COMPLETION: "#15803D",
};

/** Execution step model derived from claims, verified evidence and reconciliation. */
interface ExecutionStepDetail {
  label: string;
  value: string;
  tone?: "error" | "success";
}

interface ExecutionStep {
  key: string;
  label: string;
  state: "done" | "awaiting" | "processing" | "blocked" | "pending";
  timestamp?: string;
  source?: string;
  detail?: ExecutionStepDetail[];
}

function expectedQuantityOf(tx: TransactionDetail): number {
  return Math.round(tx.items.reduce((sum, item) => sum + item.quantity, 0) * 100) / 100;
}

function formatUnits(value: number): string {
  return `${value} units`;
}

export default function TransactionDetailPage() {
  const { transactionId } = useParams<{ transactionId: string }>();
  const { workspace } = useAuth();
  const { showToast } = useToast();
  const [tx, setTx] = useState<TransactionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<string | null>(null);
  const [eventMenuOpen, setEventMenuOpen] = useState(false);
  const eventMenuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!transactionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ transaction: TransactionDetail }>(
        `/api/transactions/${transactionId}`
      );
      setTx(res.transaction);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [transactionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (eventMenuRef.current && !eventMenuRef.current.contains(e.target as Node)) {
        setEventMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  /**
   * Publish an event from a simulated integration. The event goes through the
   * same ingestion pipeline a real integration would use; Nobryn decides what
   * it means for the transaction.
   */
  async function sendEvent(option: SimulatedEventOption) {
    if (!tx) return;
    setEventMenuOpen(false);
    try {
      // Delivery claims default to the expected quantity ("500 delivered").
      const reportedQuantity =
        option.reportedQuantity ??
        (option.type === "DELIVERY_REPORTED" ? expectedQuantityOf(tx) : undefined);
      const res = await api.post<{
        transaction: TransactionDetail;
        duplicate: boolean;
        awaitingVerification: boolean;
        result: string;
      }>(`/api/transactions/${tx.id}/events`, {
        type: option.type,
        source: option.source,
        ...(reportedQuantity != null ? { reportedQuantity } : {}),
      });
      const previousState = tx.state;
      setTx(res.transaction);
      if (res.duplicate) {
        showToast({
          title: "Event already recorded",
          description: "Nobryn ignores duplicate external events.",
        });
      } else if (res.awaitingVerification) {
        showToast({
          title: "Delivery claim received",
          description: "Awaiting verification — confirm what was actually received.",
        });
      } else if (res.transaction.state !== previousState) {
        showToast({ title: `Transaction moved to ${STATE_LABELS[res.transaction.state]}` });
      } else {
        showToast({
          title: "Event processed",
          description: `${option.label} recorded and verified under the execution rules.`,
        });
      }
    } catch (err) {
      showToast({
        title:
          err instanceof ApiClientError ? err.message : "The event could not be processed.",
        variant: "error",
      });
    }
  }

  function handleVerified(updated: TransactionDetail) {
    setConfirmOpen(false);
    setTx(updated);
    const reconciliation = updated.reconciliations.at(-1);
    if (reconciliation && reconciliation.result === "MISMATCH") {
      showToast({
        title: "Quantity mismatch detected",
        description: `Expected ${reconciliation.expected}, received ${reconciliation.received} (difference ${reconciliation.difference}). A quantity mismatch exception was created and completion is blocked.`,
      });
    } else if (reconciliation) {
      showToast({
        title: "Delivery verified",
        description: `${reconciliation.expected} ordered / ${reconciliation.received} received — MATCH. Transaction moved to ${STATE_LABELS[updated.state]}.`,
      });
    } else {
      showToast({ title: "Delivery verified" });
    }
  }

  if (loading && !tx) {
    return (
      <div className="content-max" style={{ maxWidth: "none" }}>
        <Skeleton width={140} height={14} style={{ marginBottom: 16 }} />
        <Skeleton width={280} height={28} style={{ marginBottom: 8 }} />
        <Skeleton width={200} height={16} style={{ marginBottom: 32 }} />
        <div className="detail-grid">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card card-pad">
              <Skeleton width="100%" height={24} style={{ marginBottom: 16 }} />
              <Skeleton width="70%" height={14} />
            </div>
            <div className="card card-pad">
              <Skeleton width="40%" height={16} style={{ marginBottom: 16 }} />
              <Skeleton width="100%" height={60} />
            </div>
          </div>
          <div className="card card-pad">
            <Skeleton width="60%" height={16} style={{ marginBottom: 16 }} />
            <Skeleton width="100%" height={120} />
          </div>
        </div>
      </div>
    );
  }

  if (error || !tx) {
    return (
      <div className="content-max" style={{ maxWidth: "none" }}>
        <Link to="/app/transactions" className="text-13" style={{ color: "#647067", display: "inline-block", marginBottom: 16 }}>
          ← Transactions
        </Link>
        <div className="card">
          <ErrorState
            title="Unable to load transaction"
            message="We couldn't retrieve this transaction from the transaction service."
            onRetry={() => void load()}
          />
        </div>
      </div>
    );
  }

  const openException = tx.exceptions.find(
    (x) => x.status === "OPEN" || x.status === "IN_PROGRESS"
  );
  const claim = tx.deliveryClaim;

  return (
    <div className="content-max" style={{ maxWidth: "none" }}>
      <Link to="/app/transactions" style={{ color: "#647067", display: "inline-block", marginBottom: 16 }}>
        ← Transactions
      </Link>

      {/* Header */}
      <div className="page-header page-header-row">
        <div>
          <h1 style={{ fontSize: 24, lineHeight: "32px" }}>
            Purchase Order #{tx.purchaseOrderNumber}
          </h1>
          <p className="support" style={{ letterSpacing: "0.02em", fontSize: 13 }}>
            {(workspace?.name || "Workspace").toUpperCase()} → {tx.counterpartyName.toUpperCase()}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 18, fontWeight: 600 }} className="mono">
              {formatMoney(tx.amount, tx.currency)} {tx.currency}
            </span>
            <TransactionStateBadge state={tx.state} />
            {openException ? (
              <span className="badge badge-error">
                <span className="dot" aria-hidden />
                Exception open
              </span>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} ref={eventMenuRef}>
          <div style={{ position: "relative" }}>
            <Button
              variant="secondary"
              aria-haspopup="menu"
              aria-expanded={eventMenuOpen}
              onClick={() => setEventMenuOpen((v) => !v)}
            >
              Simulate event
            </Button>
            {eventMenuOpen ? (
              <div
                role="menu"
                aria-label="Simulated external events"
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 4px)",
                  background: "#fff",
                  border: "1px solid #D9E0DC",
                  borderRadius: 6,
                  boxShadow: "0 4px 12px rgba(6,17,13,0.08)",
                  zIndex: 50,
                  minWidth: 260,
                  maxWidth: "calc(100vw - 32px)",
                  maxHeight: 360,
                  overflowY: "auto",
                  padding: 4,
                }}
              >
                <div
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    color: "#8E9892",
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                  }}
                >
                  Simulated event sources
                  <span className="badge badge-neutral" style={{ padding: "1px 6px", fontSize: 10 }}>
                    Simulated
                  </span>
                </div>
                {EVENT_SOURCE_GROUPS.map((group) => (
                  <div key={group.source}>
                    <div
                      style={{
                        padding: "8px 12px 2px",
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#647067",
                      }}
                    >
                      {group.source}
                    </div>
                    {group.events.map((event) => (
                      <button
                        key={`${group.source}-${event.type}-${event.label}`}
                        role="menuitem"
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "8px 12px",
                          background: "none",
                          border: "none",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontSize: 13,
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(6, 17, 13, 0.03)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                        onClick={() => void sendEvent(event)}
                      >
                        {event.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {openException ? (
        <div
          role="status"
          className="card"
          style={{
            padding: "12px 16px",
            marginBottom: 32,
            borderColor: "#FECACA",
            background: "#FEF2F2",
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <span aria-hidden style={{ color: "#B91C1C", fontWeight: 700, marginTop: 1 }}>!</span>
          <div style={{ fontSize: 13 }}>
            <strong>{EXCEPTION_LABELS[openException.type]}</strong> — this transaction cannot
            currently complete while the exception is open. Resolve it to continue execution.
          </div>
        </div>
      ) : null}

      {/* Verification request: an external claim is waiting for a human fact */}
      {claim ? (
        <div
          role="status"
          className="card"
          style={{
            padding: "16px 20px",
            marginBottom: 32,
            background: "#FFFBEB",
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
            <span style={{ fontWeight: 600, fontSize: 14 }}>Delivery reported</span>
            <span className="badge badge-warning">
              <span className="dot" aria-hidden />
              Awaiting verification
            </span>
          </div>
          <p style={{ margin: "8px 0 0 0", fontSize: 13, color: "#3E4A43" }}>
            The {claim.source.toLowerCase()} reported that this order was delivered (
            {claim.reference} · {formatDateTime(claim.receivedAt)}). Please confirm what was
            actually received.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 8,
              marginTop: 12,
            }}
          >
            <MetaSmall label="Expected quantity" value={formatUnits(expectedQuantityOf(tx))} />
            <MetaSmall
              label="Reported quantity"
              value={
                claim.reportedQuantity != null
                  ? formatUnits(claim.reportedQuantity)
                  : "Not specified"
              }
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <Button onClick={() => setConfirmOpen(true)}>Confirm delivery</Button>
          </div>
        </div>
      ) : null}

      <div className="detail-grid">
        {/* Main column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Expected */}
          <section className="card card-pad" aria-label="Expected">
            <h2 className="card-heading">Expected</h2>
            <p className="text-12 text-muted" style={{ margin: "4px 0 0 0" }}>
              What this transaction requires before it can complete.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                gap: 16,
                marginTop: 16,
              }}
            >
              <MetaSmall label="Order" value={`${expectedQuantityOf(tx)} units`} />
              <MetaSmall
                label="Delivery confirmation"
                value={tx.policy.deliveryConfirmationRequired ? "Required" : "Not required"}
              />
              <MetaSmall
                label="Quantity reconciliation"
                value={
                  tx.policy.quantityReconciliationRequired
                    ? `Required · tolerance ${tx.policy.quantityTolerance} units`
                    : "Not required"
                }
              />
              <MetaSmall
                label="Confirmation window"
                value={`${tx.policy.confirmationWindowHours} hours`}
              />
              <MetaSmall label="Expected delivery" value={formatDate(tx.expectedDeliveryDate)} />
              <MetaSmall label="Completion" value={tx.policy.completionCondition} />
            </div>
          </section>

          {/* Transaction state */}
          <section className="card card-pad" aria-label="Transaction state">
            <h2 className="card-heading">Transaction state</h2>
            <div style={{ marginTop: 16 }}>
              <TransactionStateTimeline state={tx.state} />
            </div>
          </section>

          {/* Execution */}
          <section className="card card-pad" aria-label="Execution">
            <h2 className="card-heading">Execution</h2>
            <p className="text-12 text-muted" style={{ margin: "4px 0 16px 0" }}>
              Each step advances when claims are verified and reconciled against what was
              expected.
            </p>
            <ExecutionList tx={tx} onConfirmDelivery={() => setConfirmOpen(true)} />
          </section>

          {/* Evidence chain */}
          <section className="card card-pad" aria-label="Evidence chain">
            <h2 className="card-heading">Evidence chain</h2>
            <p className="text-12 text-muted" style={{ margin: "4px 0 16px 0" }}>
              How Nobryn reached the current state: expectation → claim → verification →
              reconciliation → state → completion.
            </p>
            <EvidenceChain tx={tx} />
          </section>

          {/* Evidence */}
          <section className="card card-pad" aria-label="Evidence">
            <h2 className="card-heading">Evidence</h2>
            <p className="text-12 text-muted" style={{ margin: "4px 0 16px 0" }}>
              External claims and verified evidence for this transaction.
            </p>
            {tx.evidence.length === 0 ? (
              <EmptyState
                title="No evidence"
                description="Evidence will appear as transaction events are received and verified."
              />
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {tx.evidence.map((e) => (
                  <li
                    key={e.id}
                    style={{
                      border: "1px solid #D9E0DC",
                      borderRadius: 6,
                      padding: "12px 16px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 500, fontSize: 14 }}>{e.type}</span>
                      <span className={`badge ${e.verified ? "badge-success" : "badge-warning"}`}>
                        <span className="dot" aria-hidden />
                        {e.verified ? "Verified" : "Unverified"}
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginTop: 8 }}>
                      <MetaSmall label="Source" value={e.source} />
                      <MetaSmall label="Reference" value={e.reference} />
                      <MetaSmall label="Received" value={formatDateTime(e.receivedAt)} />
                    </div>
                    {e.notes ? (
                      <div className="text-12 text-muted" style={{ marginTop: 8 }}>
                        {e.notes}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {/* Reconciliation: expected vs observed */}
            {tx.reconciliations.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                {tx.reconciliations.map((reconciliation, idx) => (
                  <div
                    key={`${reconciliation.at}-${idx}`}
                    style={{ border: "1px solid #D9E0DC", borderRadius: 6, padding: "12px 16px" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ fontWeight: 500, fontSize: 14 }}>
                        Reconciliation
                        {reconciliation.approved ? " (variance approved)" : ""}
                      </span>
                      <span
                        className={`badge ${
                          reconciliation.result === "MATCH" ? "badge-success" : "badge-error"
                        }`}
                      >
                        <span className="dot" aria-hidden />
                        {reconciliation.result}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                        gap: 8,
                        marginTop: 8,
                      }}
                    >
                      <MetaSmall label="Ordered" value={formatUnits(reconciliation.expected)} />
                      <MetaSmall label="Received" value={formatUnits(reconciliation.received)} />
                      <MetaSmall
                        label="Difference"
                        value={formatUnits(reconciliation.difference)}
                      />
                    </div>
                    <div className="text-12 text-subtle" style={{ marginTop: 8 }}>
                      {formatDateTime(reconciliation.at)}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {/* Activity */}
          <section className="card card-pad" aria-label="Activity">
            <h2 className="card-heading" style={{ marginBottom: 16 }}>
              Activity
            </h2>
            {tx.activity.length === 0 ? (
              <EmptyState title="No activity" description="Activity will appear as this transaction progresses." />
            ) : (
              <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {tx.activity.map((a, idx) => (
                  <li key={a.id} style={{ display: "flex", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none" }}>
                      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 9999, background: "#D9E0DC", marginTop: 7 }} />
                      {idx < tx.activity.length - 1 ? (
                        <span aria-hidden style={{ width: 1, flex: 1, background: "#D9E0DC", minHeight: 20 }} />
                      ) : null}
                    </div>
                    <div style={{ paddingBottom: 16 }}>
                      <div style={{ fontSize: 14 }}>{a.description}</div>
                      <div
                        className="text-12"
                        style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}
                      >
                        <span style={{ fontWeight: 600, color: CATEGORY_COLOR[a.category] }}>
                          {a.category}
                        </span>
                        <span className="text-subtle">
                          · {a.actor} · {formatDateTime(a.createdAt)}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* Secondary column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Summary */}
          <section className="card card-pad" aria-label="Transaction summary">
            <h2 className="card-heading" style={{ marginBottom: 16 }}>
              Transaction
            </h2>
            <div className="meta-row">
              <span className="meta-label">Transaction</span>
              <span className="meta-value" style={{ fontWeight: 500 }}>
                {tx.purchaseOrderNumber}
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Counterparty</span>
              <span className="meta-value">{tx.counterpartyName}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Amount</span>
              <span className="meta-value mono">
                {formatMoney(tx.amount, tx.currency)} {tx.currency}
              </span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Expected delivery</span>
              <span className="meta-value">{formatDate(tx.expectedDeliveryDate)}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Created</span>
              <span className="meta-value">{formatDate(tx.createdAt)}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Description</span>
              <span className="meta-value">{tx.description}</span>
            </div>
          </section>

          {/* Exceptions */}
          <section className="card card-pad" aria-label="Exceptions">
            <h2 className="card-heading" style={{ marginBottom: 16 }}>
              Exceptions
            </h2>
            {tx.exceptions.length === 0 ? (
              <EmptyState
                title="No exceptions"
                description="No blocking exceptions have been detected for this transaction."
              />
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                {tx.exceptions.map((x) => (
                  <li key={x.id} style={{ border: "1px solid #D9E0DC", borderRadius: 6, padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <span className="badge badge-warning">
                          <span className="dot" aria-hidden />
                          {EXCEPTION_LABELS[x.type]}
                        </span>
                        <SeverityBadge severity={x.severity} />
                      </span>
                      <ExceptionStatusBadge status={x.status} />
                    </div>
                    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                      <ExceptionMeta label="Description" value={x.description} />
                      {x.expected != null ? (
                        <>
                          <ExceptionMeta label="Expected" value={`${x.expected} units`} />
                          <ExceptionMeta
                            label="Observed"
                            value={`${x.observed ?? "—"}${x.observed != null ? " units" : ""}`}
                          />
                          {x.difference != null ? (
                            <ExceptionMeta label="Difference" value={`${x.difference} units`} />
                          ) : null}
                        </>
                      ) : null}
                      <ExceptionMeta
                        label="Blocking"
                        value={x.blocking ? "Yes — completion is blocked" : "No"}
                      />
                      <ExceptionMeta label="Owner" value={x.owner ?? "Workspace team"} />
                      <ExceptionMeta label="Detected" value={formatDateTime(x.detectedAt)} />
                      {x.status !== "RESOLVED" ? (
                        <ExceptionMeta label="Age" value={formatRelative(x.detectedAt)} />
                      ) : null}
                      {x.status === "RESOLVED" ? (
                        <>
                          <ExceptionMeta label="Resolved" value={formatDateTime(x.resolvedAt ?? "")} />
                          <ExceptionMeta label="Resolution note" value={x.resolutionNote ?? ""} />
                          {x.resolvedBy ? <ExceptionMeta label="Resolved by" value={x.resolvedBy} /> : null}
                        </>
                      ) : x.nextAction ? (
                        <ExceptionMeta label="Next action" value={x.nextAction} />
                      ) : null}
                    </div>
                    {x.status !== "RESOLVED" ? (
                      <Button
                        variant="secondary"
                        style={{ marginTop: 12 }}
                        onClick={() => setResolveTarget(x.id)}
                      >
                        Resolve exception
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* External events (provenance) */}
          <section className="card card-pad" aria-label="External events">
            <h2 className="card-heading">External events</h2>
            <p className="text-12 text-muted" style={{ margin: "4px 0 16px 0" }}>
              Events received from simulated integrations and how Nobryn processed them.
            </p>
            {tx.events.length === 0 ? (
              <EmptyState
                title="No events"
                description="External events appear here as simulated integrations report them."
              />
            ) : (
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {tx.events.map((event) => (
                  <li
                    key={event.id}
                    style={{ border: "1px solid #D9E0DC", borderRadius: 6, padding: "12px 16px" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      <span
                        className="mono"
                        style={{ fontSize: 12, fontWeight: 500, overflowWrap: "anywhere" }}
                      >
                        {event.eventId}
                      </span>
                      <span
                        className={`badge ${
                          event.status === "PROCESSED"
                            ? "badge-success"
                            : event.status === "REJECTED"
                              ? "badge-error"
                              : "badge-neutral"
                        }`}
                      >
                        <span className="dot" aria-hidden />
                        {event.status}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                        gap: 8,
                        marginTop: 8,
                      }}
                    >
                      <MetaSmall label="Source" value={event.source} />
                      <MetaSmall label="Type" value={event.type} />
                      <MetaSmall label="Received" value={formatDateTime(event.receivedAt)} />
                      <MetaSmall label="Result" value={event.result ?? "—"} />
                    </div>
                    {event.detail ? (
                      <div className="text-12 text-muted" style={{ marginTop: 8 }}>
                        {event.detail}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {confirmOpen && claim ? (
        <ConfirmDeliveryModal
          tx={tx}
          onClose={() => setConfirmOpen(false)}
          onVerified={handleVerified}
        />
      ) : null}

      {resolveTarget ? (
        <ResolveExceptionModal
          exceptionId={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onResolved={async () => {
            setResolveTarget(null);
            showToast({ title: "Exception resolved" });
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function MetaSmall({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="text-12 text-muted">{label}</div>
      <div style={{ fontSize: 13, overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}

function ExceptionMeta({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span className="text-12 text-muted" style={{ flex: "none" }}>
        {label}
      </span>
      <span style={{ fontSize: 13, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}

/**
 * The execution chain is derived from claims, verified evidence and
 * reconciliation — not from manual state buttons.
 */
function ExecutionList({
  tx,
  onConfirmDelivery,
}: {
  tx: TransactionDetail;
  onConfirmDelivery: () => void;
}) {
  const latestReconciliation = tx.reconciliations.at(-1);
  const claim = tx.deliveryClaim;

  const steps: ExecutionStep[] = (() => {
    const supplierConfirmation = tx.evidence.find((e) => e.type === "Supplier confirmation");
    const fulfillment = tx.evidence.find((e) => e.type === "Fulfillment started");
    const deliveryConfirmation = tx.evidence.find((e) => e.type === "Delivery confirmation");
    const completion = tx.evidence.find((e) => e.type === "Completion verification");

    const deliveryStep: ExecutionStep = deliveryConfirmation
      ? {
          key: "delivery_confirmation",
          label: "Delivery confirmation",
          state: "done",
          timestamp: deliveryConfirmation.receivedAt,
          source: deliveryConfirmation.source,
          detail: latestReconciliation
            ? [
                { label: "Expected", value: `${latestReconciliation.expected} units` },
                { label: "Observed", value: `${latestReconciliation.received} units` },
                {
                  label: "Result",
                  value: latestReconciliation.approved
                    ? `${latestReconciliation.result} (variance approved)`
                    : latestReconciliation.withinTolerance &&
                        latestReconciliation.difference !== 0
                      ? `${latestReconciliation.result} (within tolerance)`
                      : latestReconciliation.result,
                  tone: latestReconciliation.result === "MATCH" ? "success" : "error",
                },
              ]
            : undefined,
        }
      : claim
        ? {
            key: "delivery_confirmation",
            label: "Delivery reported",
            state: "awaiting",
            timestamp: claim.receivedAt,
            source: claim.source,
            detail: [
              { label: "Expected", value: `${expectedQuantityOf(tx)} units` },
              {
                label: "Claimed",
                value:
                  claim.reportedQuantity != null
                    ? `${claim.reportedQuantity} units`
                    : "Not specified",
              },
              { label: "Verified", value: "—" },
            ],
          }
        : {
            key: "delivery_confirmation",
            label: "Delivery reported",
            state: "pending",
          };

    const completionStep: ExecutionStep = completion
      ? {
          key: "completion_verification",
          label: "Completion verification",
          state: "done",
          timestamp: completion.receivedAt,
          source: completion.source,
        }
      : tx.completionBlocking.length > 0
        ? {
            key: "completion_verification",
            label: "Completion verification",
            state: "blocked",
            detail: tx.completionBlocking.map((reason) => ({
              label: "Blocked",
              value: reason,
              tone: "error" as const,
            })),
          }
        : tx.state === "DELIVERED"
          ? {
              key: "completion_verification",
              label: "Completion verification",
              state: "processing",
            }
          : {
              key: "completion_verification",
              label: "Completion verification",
              state: "pending",
            };

    return [
      {
        key: "created",
        label: "Purchase order created",
        state: "done" as const,
        timestamp: tx.createdAt,
        source: "Nobryn",
      },
      supplierConfirmation
        ? {
            key: "supplier_confirmation",
            label: "Supplier confirmation",
            state: "done" as const,
            timestamp: supplierConfirmation.receivedAt,
            source: supplierConfirmation.source,
          }
        : { key: "supplier_confirmation", label: "Supplier confirmation", state: "pending" as const },
      fulfillment
        ? {
            key: "fulfillment",
            label: "Fulfillment",
            state: "done" as const,
            timestamp: fulfillment.receivedAt,
            source: fulfillment.source,
          }
        : { key: "fulfillment", label: "Fulfillment", state: "pending" as const },
      deliveryStep,
      completionStep,
    ];
  })();

  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 0 }}>
      {steps.map((step, idx) => (
        <li key={step.key} style={{ display: "flex", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none" }}>
            <StepMarker state={step.state} />
            {idx < steps.length - 1 ? (
              <span aria-hidden style={{ width: 1, flex: 1, background: "#D9E0DC", minHeight: 24 }} />
            ) : null}
          </div>
          <div style={{ paddingBottom: 16, flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, fontWeight: step.state === "awaiting" ? 600 : 400 }}>
                {step.label}
              </span>
              {step.state === "done" ? (
                <span className="badge badge-success">
                  <span className="dot" aria-hidden />Verified
                </span>
              ) : step.state === "awaiting" ? (
                <span className="badge badge-warning">
                  <span className="dot" aria-hidden />
                  Awaiting verification
                </span>
              ) : step.state === "processing" ? (
                <span className="badge badge-info">
                  <span className="dot" aria-hidden />
                  Processing...
                </span>
              ) : step.state === "blocked" ? (
                <span className="badge badge-error">
                  <span className="dot" aria-hidden />
                  Blocked
                </span>
              ) : (
                <span className="badge badge-neutral">
                  <span className="dot" aria-hidden />
                  Waiting
                </span>
              )}
            </div>
            {step.timestamp ? (
              <div className="text-12 text-subtle" style={{ marginTop: 2 }}>
                {formatDateTime(step.timestamp)}
                {step.source ? ` · Source: ${step.source}` : ""}
              </div>
            ) : null}
            {step.detail ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 6 }}>
                {step.detail.map((line) => (
                  <div key={line.label} style={{ display: "flex", gap: 8 }}>
                    <span className="text-12 text-muted" style={{ width: 64, flex: "none" }}>
                      {line.label}
                    </span>
                    <span
                      className="text-12"
                      style={{
                        color:
                          line.tone === "error"
                            ? "#B91C1C"
                            : line.tone === "success"
                              ? "#15803D"
                              : "#3E4A43",
                        fontWeight: line.tone ? 500 : 400,
                        minWidth: 0,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {line.value}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {step.state === "awaiting" ? (
              <div style={{ marginTop: 10 }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={onConfirmDelivery}>
                  Confirm delivery
                </button>
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function StepMarker({ state }: { state: ExecutionStep["state"] }) {
  return (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        borderRadius: 9999,
        marginTop: 4,
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 9,
        fontWeight: 700,
        color: "#fff",
        background:
          state === "done"
            ? "#15803D"
            : state === "processing"
              ? "#C8FF00"
              : state === "awaiting"
                ? "#B45309"
                : state === "blocked"
                  ? "#B91C1C"
                  : "#D9E0DC",
        border:
          state === "pending"
            ? "1px solid #D9E0DC"
            : state === "processing"
              ? "1px solid #06110D"
              : "none",
      }}
    >
      {state === "done" ? "✓" : state === "blocked" ? "!" : ""}
    </span>
  );
}

/**
 * The provenance chain: how Nobryn reached the current state, from the
 * original expectation through claim, verification, reconciliation and state
 * changes to completion.
 */
interface ChainNode {
  key: string;
  label: string;
  state: "done" | "awaiting" | "processing" | "blocked" | "pending";
  badge: { text: string; className: string };
  rows?: ExecutionStepDetail[];
  timestamp?: string;
}

function EvidenceChain({ tx }: { tx: TransactionDetail }) {
  const expected = expectedQuantityOf(tx);
  const claimEvidence = tx.evidence.find((e) => e.type === "Delivery reported");
  const verifiedEvidence = tx.evidence.find((e) => e.type === "Delivery confirmation");
  const completionEvidence = tx.evidence.find((e) => e.type === "Completion verification");
  const latestReconciliation = tx.reconciliations.at(-1);

  const claimActivity = claimEvidence
    ? tx.activity.find((a) => {
        const m = (a.metadata ?? null) as Record<string, unknown> | null;
        return a.type === "CLAIM_RECEIVED" && m?.reference === claimEvidence.reference;
      })
    : undefined;
  const reportedRaw = claimActivity?.metadata?.reportedQuantity;
  const reported = typeof reportedRaw === "number" ? reportedRaw : null;
  const verifyActivity = tx.activity.find((a) => a.type === "CLAIM_VERIFIED");
  const stateChanges = tx.activity
    .filter((a) => a.type === "STATE_CHANGED")
    .slice()
    .reverse()
    .map((a) => {
      const m = (a.metadata ?? null) as Record<string, unknown> | null;
      return {
        from: m && typeof m.from === "string" ? m.from : "",
        to: m && typeof m.to === "string" ? m.to : "",
      };
    })
    .filter((s) => s.from && s.to);

  const nodes: ChainNode[] = [
    {
      key: "expectation",
      label: "Transaction expectation",
      state: "done",
      badge: { text: "Expected", className: "badge badge-neutral" },
      rows: [
        { label: "Order", value: `${expected} units` },
        {
          label: "Delivery",
          value: tx.policy.deliveryConfirmationRequired
            ? "Confirmation required"
            : "Confirmation not required",
        },
      ],
      timestamp: tx.createdAt,
    },
    claimEvidence
      ? {
          key: "claim",
          label: "Delivery claim",
          state: "done",
          badge: { text: "Unverified", className: "badge badge-warning" },
          rows: [
            { label: "Source", value: claimEvidence.source },
            {
              label: "Claim",
              value: reported != null ? `${reported} units delivered` : "Order delivered",
            },
            { label: "Reference", value: claimEvidence.reference },
          ],
          timestamp: claimEvidence.receivedAt,
        }
      : {
          key: "claim",
          label: "Delivery claim",
          state: "pending",
          badge: { text: "Waiting", className: "badge badge-neutral" },
        },
    verifiedEvidence
      ? {
          key: "verification",
          label: "Delivery verification",
          state: "done",
          badge: { text: "Verified", className: "badge badge-success" },
          rows: [
            { label: "Confirmed by", value: verifyActivity?.actor ?? "Human confirmation" },
            {
              label: "Observed",
              value: latestReconciliation ? `${latestReconciliation.received} units` : "—",
            },
            { label: "Method", value: "Human confirmation" },
          ],
          timestamp: verifiedEvidence.receivedAt,
        }
      : claimEvidence
        ? {
            key: "verification",
            label: "Delivery verification",
            state: "awaiting",
            badge: { text: "Awaiting verification", className: "badge badge-warning" },
            rows: [{ label: "Observed", value: "—" }],
          }
        : {
            key: "verification",
            label: "Delivery verification",
            state: "pending",
            badge: { text: "Waiting", className: "badge badge-neutral" },
          },
    latestReconciliation
      ? {
          key: "reconciliation",
          label: "Reconciliation",
          state: latestReconciliation.result === "MATCH" ? "done" : "blocked",
          badge: {
            text: `${latestReconciliation.result}${
              latestReconciliation.approved
                ? " (approved)"
                : latestReconciliation.withinTolerance && latestReconciliation.difference !== 0
                  ? " (within tolerance)"
                  : ""
            }`,
            className:
              latestReconciliation.result === "MATCH"
                ? "badge badge-success"
                : "badge badge-error",
          },
          rows: [
            { label: "Expected", value: `${latestReconciliation.expected} units` },
            { label: "Observed", value: `${latestReconciliation.received} units` },
            { label: "Difference", value: `${latestReconciliation.difference} units` },
          ],
          timestamp: latestReconciliation.at,
        }
      : {
          key: "reconciliation",
          label: "Reconciliation",
          state: "pending",
          badge: { text: "Waiting", className: "badge badge-neutral" },
        },
    stateChanges.length > 0
      ? {
          key: "state",
          label: "State change",
          state: "done",
          badge: { text: "Recorded", className: "badge badge-info" },
          rows: stateChanges.map((s) => ({ label: "State", value: `${s.from} → ${s.to}` })),
        }
      : {
          key: "state",
          label: "State change",
          state: "pending",
          badge: { text: "Waiting", className: "badge badge-neutral" },
        },
    completionEvidence
      ? {
          key: "completion",
          label: "Completion evaluation",
          state: "done",
          badge: { text: "Satisfied", className: "badge badge-success" },
          rows: [
            { label: "Result", value: "All required conditions satisfied", tone: "success" },
          ],
          timestamp: completionEvidence.receivedAt,
        }
      : tx.completionBlocking.length > 0
        ? {
            key: "completion",
            label: "Completion evaluation",
            state: "blocked",
            badge: { text: "Blocked", className: "badge badge-error" },
            rows: tx.completionBlocking.map((reason) => ({
              label: "Blocked",
              value: reason,
              tone: "error" as const,
            })),
          }
        : {
            key: "completion",
            label: "Completion evaluation",
            state: "pending",
            badge: { text: "Waiting", className: "badge badge-neutral" },
          },
  ];

  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {nodes.map((node, idx) => (
        <li key={node.key} style={{ display: "flex", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none" }}>
            <StepMarker state={node.state} />
            {idx < nodes.length - 1 ? (
              <span aria-hidden style={{ width: 1, flex: 1, background: "#D9E0DC", minHeight: 24 }} />
            ) : null}
          </div>
          <div style={{ paddingBottom: 16, flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14 }}>{node.label}</span>
              <span className={node.badge.className}>
                <span className="dot" aria-hidden />
                {node.badge.text}
              </span>
            </div>
            {node.timestamp ? (
              <div className="text-12 text-subtle" style={{ marginTop: 2 }}>
                {formatDateTime(node.timestamp)}
              </div>
            ) : null}
            {node.rows ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 6 }}>
                {node.rows.map((row, rowIdx) => (
                  <div key={`${row.label}-${rowIdx}`} style={{ display: "flex", gap: 8 }}>
                    <span className="text-12 text-muted" style={{ width: 96, flex: "none" }}>
                      {row.label}
                    </span>
                    <span
                      className="text-12"
                      style={{
                        color:
                          row.tone === "error"
                            ? "#B91C1C"
                            : row.tone === "success"
                              ? "#15803D"
                              : "#3E4A43",
                        fontWeight: row.tone ? 500 : 400,
                        minWidth: 0,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Confirming delivery is a human fact confirmation, not a state change:
 * the user says what was actually received and Nobryn reconciles + advances.
 */
function ConfirmDeliveryModal({
  tx,
  onClose,
  onVerified,
}: {
  tx: TransactionDetail;
  onClose: () => void;
  onVerified: (updated: TransactionDetail) => void;
}) {
  const expected = expectedQuantityOf(tx);
  const [received, setReceived] = useState(String(expected));
  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    const quantity = Number(received);
    if (!received || Number.isNaN(quantity) || quantity <= 0) {
      setError("Received quantity must be greater than zero.");
      return;
    }
    if (!deliveryDate) {
      setError("Delivery date is required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<{ transaction: TransactionDetail }>(
        `/api/transactions/${tx.id}/verify`,
        {
          receivedQuantity: quantity,
          deliveryDate,
          ...(note.trim() ? { note: note.trim() } : {}),
        }
      );
      onVerified(res.transaction);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Could not confirm the delivery. Please try again."
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="Confirm delivery"
      description="Confirm what was actually received for this order."
      onClose={onClose}
    >
      <div className="meta-row">
        <span className="meta-label">Expected quantity</span>
        <span className="meta-value mono">{expected} units</span>
      </div>
      <div className="field">
        <label htmlFor="received-quantity">Received quantity</label>
        <Input
          id="received-quantity"
          type="number"
          min="1"
          step="1"
          value={received}
          invalid={!!error}
          onChange={(e) => {
            setReceived(e.target.value);
            setError(null);
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="delivery-date">Delivery date</label>
        <Input
          id="delivery-date"
          type="date"
          value={deliveryDate}
          onChange={(e) => {
            setDeliveryDate(e.target.value);
            setError(null);
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="delivery-note">Optional note</label>
        <Textarea
          id="delivery-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Two pallets arrived damaged and were set aside."
        />
      </div>
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <Button onClick={() => void handleConfirm()} loading={submitting} loadingText="Verifying...">
          Confirm and verify
        </Button>
      </div>
    </Modal>
  );
}

function ResolveExceptionModal({
  exceptionId,
  onClose,
  onResolved,
}: {
  exceptionId: string;
  onClose: () => void;
  onResolved: () => void | Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  async function handleResolve() {
    if (!note.trim()) {
      setError("Resolution note is required.");
      return;
    }
    setResolving(true);
    try {
      await api.post(`/api/exceptions/${exceptionId}/resolve`, { resolutionNote: note.trim() });
      await onResolved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not resolve the exception. Please try again.");
      setResolving(false);
    }
  }

  return (
    <Modal title="Resolve exception" description="Record how this exception was resolved." onClose={onClose}>
      <div className="field">
        <label htmlFor="resolution-note">Resolution note</label>
        <Textarea
          id="resolution-note"
          value={note}
          invalid={!!error}
          onChange={(e) => {
            setNote(e.target.value);
            setError(null);
          }}
          placeholder="Supplier confirmed that the remaining 30 units will be delivered separately."
        />
        {error ? (
          <span className="field-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={resolving}>
          Cancel
        </button>
        <Button onClick={() => void handleResolve()} loading={resolving} loadingText="Resolving...">
          Resolve exception
        </Button>
      </div>
    </Modal>
  );
}
