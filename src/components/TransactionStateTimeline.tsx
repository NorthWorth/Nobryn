import { STATE_LABELS, STATE_ORDER } from "../lib/types";
import type { TransactionState } from "../lib/types";

/**
 * State progression: completed states show a check, the current state a filled
 * blue dot, future states a muted hollow dot. Vertical on small screens.
 */
export function TransactionStateTimeline({ state }: { state: TransactionState }) {
  const currentIndex = STATE_ORDER.indexOf(state);
  return (
    <ol
      className="flex flex-col gap-0 md:flex-row md:items-center md:gap-0"
      aria-label="Transaction state progression"
    >
      {STATE_ORDER.map((s, i) => {
        const done = i < currentIndex;
        const current = i === currentIndex;
        return (
          <li key={s} className="flex md:items-center md:flex-1 last:md:flex-none">
            <div className="flex items-center gap-8px md:flex-1 md:justify-start" style={{ gap: 8 }}>
              <span
                aria-hidden
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9999,
                  flex: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 600,
                  border: done
                    ? "1px solid #15803D"
                    : current
                      ? "1px solid #2563EB"
                      : "1px solid #CBD5E1",
                  background: done ? "#15803D" : current ? "#2563EB" : "#FFFFFF",
                  color: done || current ? "#FFFFFF" : "#94A3B8",
                }}
              >
                {done ? "✓" : current ? "●" : ""}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: current ? 600 : 400,
                  color: done ? "#15803D" : current ? "#0B1220" : "#94A3B8",
                }}
              >
                {STATE_LABELS[s]}
                {current ? " (current)" : ""}
              </span>
            </div>
            {i < STATE_ORDER.length - 1 ? (
              <span
                aria-hidden
                className="hidden md:block"
                style={{
                  flex: 1,
                  height: 1,
                  background: done ? "#86EFAC" : "#E2E8F0",
                  margin: "0 12px",
                  minWidth: 24,
                }}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
