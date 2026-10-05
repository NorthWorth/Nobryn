import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useEffect } from "react";
import type { ExceptionStatus, TransactionState } from "../lib/types";
import { EXCEPTION_LABELS, EXCEPTION_STATUS_LABELS, STATE_LABELS } from "../lib/types";

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
  loadingText?: string;
}

export function Button({
  variant = "primary",
  loading = false,
  loadingText,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`btn btn-${variant}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (loadingText ?? "Loading...") : children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}

export function Field({ label, error, children, htmlFor }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : null}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ invalid, className, ...rest }: InputProps) {
  return <input className={`input${invalid ? " invalid" : ""}${className ? ` ${className}` : ""}`} {...rest} />;
}

export function Select({ invalid, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select className={`select${invalid ? " invalid" : ""}${className ? ` ${className}` : ""}`} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ invalid, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={`textarea${invalid ? " invalid" : ""}${className ? ` ${className}` : ""}`}
      {...rest}
    />
  );
}

// ---------------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------------

const STATE_BADGE: Record<TransactionState, string> = {
  CREATED: "badge-neutral",
  ACCEPTED: "badge-info",
  FULFILLING: "badge-info",
  DELIVERED: "badge-success",
  COMPLETED: "badge-success",
};

export function TransactionStateBadge({ state }: { state: TransactionState }) {
  return (
    <span className={`badge ${STATE_BADGE[state]}`}>
      <span className="dot" aria-hidden />
      {STATE_LABELS[state]}
    </span>
  );
}

const EXCEPTION_STATUS_BADGE: Record<ExceptionStatus, string> = {
  OPEN: "badge-error",
  IN_PROGRESS: "badge-info",
  RESOLVED: "badge-success",
};

export function ExceptionStatusBadge({ status }: { status: ExceptionStatus }) {
  return (
    <span className={`badge ${EXCEPTION_STATUS_BADGE[status]}`}>
      <span className="dot" aria-hidden />
      {EXCEPTION_STATUS_LABELS[status]}
    </span>
  );
}

export function ExceptionTypeBadge({ type }: { type: keyof typeof EXCEPTION_LABELS }) {
  return <span className="badge badge-warning">{EXCEPTION_LABELS[type]}</span>;
}

// ---------------------------------------------------------------------------
// Empty / error states
// ---------------------------------------------------------------------------

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="empty-state" role="alert">
      <h3>{title}</h3>
      <p>{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

export function Skeleton({ width, height, style }: { width?: number | string; height?: number | string; style?: React.CSSProperties }) {
  return <span className="skeleton" style={{ display: "block", width, height, ...style }} aria-hidden />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap">
      <table className="nbt" style={{ minHeight: 0 }}>
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i}>
                <Skeleton width={64} height={12} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}>
                  <Skeleton width={c === 0 ? 120 : 80} height={14} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card card-pad">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === 0 ? "40%" : "80%"} height={14} style={{ marginBottom: 12 }} />
      ))}
    </div>
  );
}

export function SummarySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card card-pad">
          <Skeleton width={120} height={12} style={{ marginBottom: 8 }} />
          <Skeleton width={64} height={28} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  title,
  description,
  onClose,
  children,
  width = 480,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          {description ? <p className="modal-desc">{description}</p> : null}
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
