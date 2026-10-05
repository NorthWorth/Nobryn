import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiClientError } from "../lib/api";
import {
  ACTION_LABELS,
  EXCEPTION_LABELS,
  formatDateTime,
  formatMoney,
  formatDate,
  STATE_LABELS,
} from "../lib/types";
import type { ExceptionType, TransactionDetail } from "../lib/types";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import {
  Button,
  EmptyState,
  ErrorState,
  ExceptionStatusBadge,
  Modal,
  Skeleton,
  Textarea,
  TransactionStateBadge,
} from "../components/ui";
import { TransactionStateTimeline } from "../components/TransactionStateTimeline";

/** Execution step model derived from transaction state + evidence + activity. */
interface ExecutionStep {
  key: string;
  label: string;
  state: "done" | "processing" | "failed" | "pending";
  timestamp?: string;
  source?: string;
}

const STEP_DEFS: { key: string; label: string; evidenceType: string }[] = [
  { key: "created", label: "Purchase order created", evidenceType: "" },
  { key: "supplier_confirmation", label: "Supplier confirmation", evidenceType: "Supplier confirmation" },
  { key: "fulfillment", label: "Fulfillment", evidenceType: "Fulfillment started" },
  { key: "delivery_confirmation", label: "Delivery confirmation", evidenceType: "Delivery confirmation" },
  { key: "completion_verification", label: "Completion verification", evidenceType: "Completion verification" },
];

export default function TransactionDetailPage() {
  const { transactionId } = useParams<{ transactionId: string }>();
  const { workspace } = useAuth();
  const { showToast } = useToast();
  const [tx, setTx] = useState<TransactionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<string | null>(null);
  const [simMenuOpen, setSimMenuOpen] = useState(false);
  const simRef = useRef<HTMLDivElement>(null);

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
      if (simRef.current && !simRef.current.contains(e.target as Node)) {
        setSimMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function advance() {
    if (!tx) return;
    setAdvancing(true);
    try {
      const res = await api.post<{ transaction: TransactionDetail }>(
        `/api/transactions/${tx.id}/execute`
      );
      setTx(res.transaction);
      const nextLabel = STATE_LABELS[res.transaction.state];
      showToast({ title: `Transaction moved to ${nextLabel}` });
    } catch (err) {
      if (err instanceof ApiClientError) {
        showToast({ title: "Execution failed", description: err.message, variant: "error" });
      } else {
        showToast({ title: "Execution failed. Please try again.", variant: "error" });
      }
    } finally {
      setAdvancing(false);
    }
  }

  async function simulateException(type: ExceptionType) {
    if (!tx) return;
    setSimMenuOpen(false);
    try {
      await api.post(`/api/transactions/${tx.id}/exceptions`, { type });
      showToast({
        title: `${EXCEPTION_LABELS[type]} exception created`,
        description: "Exception events are simulated by the Nobryn execution engine.",
      });
      await load();
    } catch (err) {
      showToast({
        title: err instanceof ApiClientError ? err.message : "Could not create exception.",
        variant: "error",
      });
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
        <Link to="/app/transactions" className="text-13" style={{ color: "#64748B", display: "inline-block", marginBottom: 16 }}>
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

  const nextAction = ACTION_LABELS[tx.state];
  const openException = tx.exceptions.find(
    (x) => x.status === "OPEN" || x.status === "IN_PROGRESS"
  );

  return (
    <div className="content-max" style={{ maxWidth: "none" }}>
      <Link to="/app/transactions" style={{ color: "#64748B", display: "inline-block", marginBottom: 16 }}>
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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }} ref={simRef}>
          {nextAction ? (
            <Button onClick={() => void advance()} loading={advancing} loadingText={`${nextAction}...`}>
              {nextAction}
            </Button>
          ) : null}
          <div style={{ position: "relative" }}>
            <Button
              variant="secondary"
              aria-haspopup="menu"
              aria-expanded={simMenuOpen}
              onClick={() => setSimMenuOpen((v) => !v)}
            >
              More actions
            </Button>
            {simMenuOpen ? (
              <div
                role="menu"
                aria-label="Additional actions"
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 4px)",
                  background: "#fff",
                  border: "1px solid #E2E8F0",
                  borderRadius: 6,
                  boxShadow: "0 4px 12px rgba(11,18,32,0.08)",
                  zIndex: 50,
                  minWidth: 220,
                  padding: 4,
                }}
              >                                <div style={{ padding: "6px 12px", fontSize: 12, color: "#94A3B8", display: "flex", gap: 6, alignItems: "center" }}>
                                  Exception simulation
                                  <span className="badge badge-neutral" style={{ padding: "1px 6px", fontSize: 10 }}>Simulated</span>
                                </div>
                {(Object.keys(EXCEPTION_LABELS) as ExceptionType[]).map((type) => (
                  <button
                    key={type}
                    role="menuitem"
                    className="text-13"
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
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#F8FAFC")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                    onClick={() => void simulateException(type)}
                  >
                    Simulate exception: {EXCEPTION_LABELS[type]}
                  </button>
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

      <div className="detail-grid">
        {/* Main column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
              Track each step required to complete this transaction.
            </p>
            <ExecutionList tx={tx} advancing={advancing} />
          </section>

          {/* Evidence */}
          <section className="card card-pad" aria-label="Evidence">
            <h2 className="card-heading">Evidence</h2>
            <p className="text-12 text-muted" style={{ margin: "4px 0 16px 0" }}>
              Records used to verify transaction state.
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
                      border: "1px solid #E2E8F0",
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
                  </li>
                ))}
              </ul>
            )}
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
                      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 9999, background: "#CBD5E1", marginTop: 7 }} />
                      {idx < tx.activity.length - 1 ? (
                        <span aria-hidden style={{ width: 1, flex: 1, background: "#E2E8F0", minHeight: 20 }} />
                      ) : null}
                    </div>
                    <div style={{ paddingBottom: 16 }}>
                      <div style={{ fontSize: 14 }}>{a.description}</div>
                      <div className="text-12 text-subtle">{formatDateTime(a.createdAt)}</div>
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
                  <li key={x.id} style={{ border: "1px solid #E2E8F0", borderRadius: 6, padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="badge badge-warning">
                        <span className="dot" aria-hidden />
                        {EXCEPTION_LABELS[x.type]}
                      </span>
                      <ExceptionStatusBadge status={x.status} />
                    </div>
                    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                      <ExceptionMeta label="Description" value={x.description} />
                      {x.type === "QUANTITY_MISMATCH" && x.status !== "RESOLVED" ? (
                        <>
                          <ExceptionMeta label="Expected" value="500 units" />
                          <ExceptionMeta label="Received" value="470 units" />
                          <ExceptionMeta label="Difference" value="-30 units" />
                        </>
                      ) : null}
                      <ExceptionMeta label="Detected" value={formatDateTime(x.detectedAt)} />
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
                        className=""
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
        </div>
      </div>

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
    <div>
      <div className="text-12 text-muted">{label}</div>
      <div style={{ fontSize: 13 }}>{value}</div>
    </div>
  );
}

function ExceptionMeta({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span className="text-12 text-muted" style={{ flex: "none" }}>
        {label}
      </span>
      <span style={{ fontSize: 13, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function ExecutionList({ tx, advancing }: { tx: TransactionDetail; advancing: boolean }) {
  const steps: ExecutionStep[] = STEP_DEFS.map((def, idx) => {
    if (def.key === "created") {
      return {
        key: def.key,
        label: def.label,
        state: "done",
        timestamp: tx.createdAt,
        source: "Nobryn",
      };
    }
    const evidence = tx.evidence.find((e) => e.type === def.evidenceType);
    const currentState = tx.state;
    const stepIndex = idx; // supplier_confirmation=1, fulfillment=2, delivery=3, completion=4
    const stateIndex = currentState === "COMPLETED" ? 4 : currentState === "DELIVERED" ? 3 : currentState === "FULFILLING" ? 2 : currentState === "ACCEPTED" ? 1 : 0;
    if (evidence) {
      return {
        key: def.key,
        label: def.label,
        state: "done",
        timestamp: evidence.receivedAt,
        source: evidence.source,
      };
    }
    if (stepIndex === stateIndex + 1) {
      return {
        key: def.key,
        label: def.label,
        state: advancing ? "processing" : "pending",
      };
    }
    if (stepIndex <= stateIndex) {
      return { key: def.key, label: def.label, state: "failed" };
    }
    return { key: def.key, label: def.label, state: "pending" };
  });

  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 0 }}>
      {steps.map((step, idx) => (
        <li key={step.key} style={{ display: "flex", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none" }}>
            <StepMarker state={step.state} />
            {idx < steps.length - 1 ? (
              <span aria-hidden style={{ width: 1, flex: 1, background: "#E2E8F0", minHeight: 24 }} />
            ) : null}
          </div>
          <div style={{ paddingBottom: 16, flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, fontWeight: step.state === "processing" ? 600 : 400 }}>
                {step.label}
              </span>
              {step.state === "done" ? (
                <span className="badge badge-success">
                  <span className="dot" aria-hidden />Verified
                </span>
              ) : step.state === "processing" ? (
                <span className="badge badge-info">
                  <span className="dot" aria-hidden />
                  Processing...
                </span>
              ) : step.state === "failed" ? (
                <span className="badge badge-error">
                  <span className="dot" aria-hidden />Pending evidence
                </span>
              ) : (
                <span className="badge badge-neutral">
                  <span className="dot" aria-hidden />Waiting
                </span>
              )}
            </div>
            {step.timestamp ? (
              <div className="text-12 text-subtle" style={{ marginTop: 2 }}>
                {formatDateTime(step.timestamp)}
                {step.source ? ` · Source: ${step.source}` : ""}
              </div>
            ) : step.state === "processing" ? (
              <div className="text-12 text-subtle" style={{ marginTop: 2 }}>
                Executing step via simulated integration...
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
              ? "#2563EB"
              : state === "failed"
                ? "#CBD5E1"
                : "#E2E8F0",
        border: state === "pending" ? "1px solid #CBD5E1" : "none",
      }}
    >
      {state === "done" ? "✓" : state === "failed" ? "!" : ""}
    </span>
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
