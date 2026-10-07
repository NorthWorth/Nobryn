import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiClientError } from "../lib/api";
import { formatDateTime } from "../lib/types";
import type { NotificationItem, NotificationSeverity } from "../lib/types";
import { useToast } from "../lib/toast";
import {
  Button,
  CardSkeleton,
  EmptyState,
  ErrorState,
} from "../components/ui";

const SEVERITY_BADGE: Record<NotificationSeverity, string> = {
  INFO: "badge-info",
  WARNING: "badge-warning",
  ERROR: "badge-error",
};

const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  INFO: "Info",
  WARNING: "Warning",
  ERROR: "Error",
};

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [data, setData] = useState<{
    notifications: NotificationItem[];
    unreadCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ notifications: NotificationItem[]; unreadCount: number }>(
        "/api/notifications"
      );
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Mark as read (when unread) and go to the related transaction/exception. */
  async function openNotification(notification: NotificationItem) {
    setOpeningId(notification.id);
    try {
      if (!notification.readAt) {
        await api.post(`/api/notifications/${notification.id}/read`);
      }
      navigate(notification.targetPath);
    } catch (err) {
      setOpeningId(null);
      showToast({
        title:
          err instanceof ApiClientError ? err.message : "Could not open this notification.",
        variant: "error",
      });
    }
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await api.post("/api/notifications/read-all");
      showToast({ title: "All notifications marked as read" });
      await load();
    } catch (err) {
      showToast({
        title:
          err instanceof ApiClientError
            ? err.message
            : "Could not mark notifications as read.",
        variant: "error",
      });
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className="content-max" style={{ maxWidth: 880 }}>
      <div className="page-header page-header-row">
        <div>
          <h1>Notifications</h1>
          <p className="support">
            Operational events from your transactions — verifications needed, exceptions and
            completions.
          </p>
        </div>
        {data && data.unreadCount > 0 ? (
          <Button
            variant="secondary"
            onClick={() => void markAllRead()}
            loading={markingAll}
            loadingText="Marking..."
          >
            Mark all as read
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="card">
          <ErrorState
            title="Unable to load notifications"
            message="We couldn't retrieve your notifications from the transaction service."
            onRetry={() => void load()}
          />
        </div>
      ) : loading && !data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
        </div>
      ) : data && data.notifications.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No notifications"
            description="Notifications appear here when a transaction needs confirmation, an exception is raised or resolved, or a transaction completes."
          />
        </div>
      ) : data ? (
        <div className="card" style={{ overflow: "hidden" }}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {data.notifications.map((notification, idx) => {
              const unread = !notification.readAt;
              return (
                <li
                  key={notification.id}
                  style={{
                    borderBottom:
                      idx < data.notifications.length - 1 ? "1px solid #D9E0DC" : "none",
                  }}
                >
                  <button
                    type="button"
                    disabled={openingId === notification.id}
                    onClick={() => void openNotification(notification)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      width: "100%",
                      textAlign: "left",
                      padding: "14px 24px",
                      background: "none",
                      border: "none",
                      cursor: openingId === notification.id ? "wait" : "pointer",
                      opacity: openingId === notification.id ? 0.7 : 1,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(6, 17, 13, 0.03)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    <span
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          minWidth: 0,
                        }}
                      >
                        {unread ? (
                          <span
                            aria-hidden
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: 9999,
                              background: "#06110D",
                              flex: "none",
                            }}
                          />
                        ) : null}
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: unread ? 600 : 500,
                            overflowWrap: "anywhere",
                          }}
                        >
                          {notification.title}
                        </span>
                      </span>
                      <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        <span className={`badge ${SEVERITY_BADGE[notification.severity]}`}>
                          <span className="dot" aria-hidden />
                          {SEVERITY_LABEL[notification.severity]}
                        </span>
                        <span className="text-12 text-subtle" style={{ whiteSpace: "nowrap" }}>
                          {formatDateTime(notification.createdAt)}
                        </span>
                      </span>
                    </span>
                    <span
                      style={{ fontSize: 13, color: "#647067", overflowWrap: "anywhere" }}
                    >
                      {notification.description}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
