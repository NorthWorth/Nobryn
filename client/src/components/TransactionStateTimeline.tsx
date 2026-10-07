import { STATE_LABELS, STATE_ORDER } from "../lib/types";
import type { TransactionState } from "../lib/types";

/**
 * State progression: completed states show a check, the current state a
 * filled lime dot (the active transaction indicator), future states a muted
 * hollow dot. Vertical below the desktop breakpoint (so it never forces
 * horizontal overflow in narrow columns), horizontal with a wrap fallback on
 * desktop.
 */
export function TransactionStateTimeline({ state }: { state: TransactionState }) {
  const currentIndex = STATE_ORDER.indexOf(state);
  return (
    <ol
      className="flex flex-col gap-0 xl:flex-row xl:flex-wrap xl:items-center xl:gap-0"
      aria-label="Transaction state progression"
    >
      {STATE_ORDER.map((s, i) => {
        const done = i < currentIndex;
        const current = i === currentIndex;
        return (
          <li key={s} className="flex xl:items-center xl:flex-1 last:xl:flex-none">
            <div className="flex items-center gap-8px xl:flex-1 xl:justify-start" style={{ gap: 8 }}>
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
                      ? "1px solid #06110D"
                      : "1px solid #D9E0DC",
                  background: done ? "#15803D" : current ? "#C8FF00" : "#FFFFFF",
                  color: done ? "#FFFFFF" : current ? "#06110D" : "#8E9892",
                }}
              >
                {done ? "✓" : current ? "●" : ""}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: current ? 600 : 400,
                  color: done ? "#15803D" : current ? "#06110D" : "#647067",
                }}
              >
                {STATE_LABELS[s]}
                {current ? " (current)" : ""}
              </span>
            </div>
            {i < STATE_ORDER.length - 1 ? (
              <span
                aria-hidden
                className="hidden xl:block"
                style={{
                  flex: 1,
                  height: 1,
                  background: done ? "#86EFAC" : "#D9E0DC",
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
