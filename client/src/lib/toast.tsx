import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";

interface Toast {
  id: number;
  title: string;
  description?: string;
  variant: "success" | "error" | "info";
}

interface ToastContextValue {
  showToast: (toast: { title: string; description?: string; variant?: Toast["variant"] }) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const showToast = useCallback(
    ({ title, description, variant = "success" }: { title: string; description?: string; variant?: Toast["variant"] }) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, title, description, variant }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast${toast.variant === "error" ? " toast-error" : ""}`}
          >
            <span
              className={`dot ${toast.variant === "error" ? "text-error" : "text-success"}`}
              style={{
                width: 8,
                height: 8,
                borderRadius: 9999,
                background: toast.variant === "error" ? "#B91C1C" : "#15803D",
                flex: "none",
                marginTop: 6,
              }}
              aria-hidden
            />
            <div>
              <div className="toast-title">{toast.title}</div>
              {toast.description ? <div className="toast-desc">{toast.description}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
