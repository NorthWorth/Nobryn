import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { formatDateTime, formatRelative, EXCEPTION_LABELS } from "../lib/types";
import type { ExceptionListRow } from "../lib/types";
import {
  EmptyState,
  ErrorState,
  ExceptionStatusBadge,
  Select,
  SeverityBadge,
  TableSkeleton,
} from "../components/ui";

const FILTERS = [
  { value: "ALL", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "RESOLVED", label: "Resolved" },
];

export default function ExceptionsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ExceptionListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("ALL");

  const load = useCallback(async (status: string) => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status !== "ALL") params.set("status", status);
      const qs = params.toString();
      const data = await api.get<ExceptionListRow[]>(`/api/exceptions${qs ? `?${qs}` : ""}`);
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }, []);

  useEffect(() => {
    void load("ALL");
  }, [load]);

  return (
    <div className="content-max" style={{ maxWidth: "none" }}>
      <div className="page-header">
        <h1>Exceptions</h1>
        <p className="support">
          Identify and resolve transaction issues that require attention.
        </p>
      </div>

      <div className="toolbar">
        <div className="toolbar-filter">
          <Select
            aria-label="Filter exceptions by status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              void load(e.target.value);
            }}
          >
            {FILTERS.map((f) => (
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
            title="Unable to load exceptions"
            message="We couldn't retrieve exceptions from the transaction service."
            onRetry={() => void load(statusFilter)}
          />
        </div>
      ) : rows === null ? (
        <TableSkeleton rows={6} cols={7} />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No open exceptions"
            description="There are no transaction issues requiring attention."
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="nbt">
            <thead>                <tr>
                  <th>Exception</th>
                  <th>Transaction</th>
                  <th>Severity</th>
                  <th>Blocking</th>
                  <th>Detected</th>
                  <th>Status</th>
                  <th>Next action</th>
                </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr
                  key={x.id}
                  className="clickable"
                  tabIndex={0}
                  aria-label={`Open transaction for ${EXCEPTION_LABELS[x.type]} exception`}
                  onClick={() => navigate(`/app/transactions/${x.transactionId}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") navigate(`/app/transactions/${x.transactionId}`);
                  }}
                >
                  <td style={{ fontWeight: 500 }}>{EXCEPTION_LABELS[x.type]}</td>
                  <td>{x.purchaseOrderNumber}</td>
                  <td>
                    <SeverityBadge severity={x.severity} />
                  </td>
                  <td className="text-12 text-muted">
                    {x.blocking ? "Blocking" : "Non-blocking"}
                  </td>
                  <td className="text-12 text-muted">
                    {formatDateTime(x.detectedAt)}
                    <div className="secondary">{formatRelative(x.detectedAt)}</div>
                  </td>
                  <td>
                    <ExceptionStatusBadge status={x.status} />
                  </td>
                  <td className="text-13 text-muted" style={{ fontSize: 13 }}>
                    {x.status === "RESOLVED" ? `Resolved ${formatDateTime(x.resolvedAt ?? "")}` : x.nextAction ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
