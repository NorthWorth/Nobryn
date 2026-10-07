import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { useQuery } from "../lib/query";

const NAV_ITEMS = [
  { to: "/app/overview", label: "Overview", icon: NavIconGrid },
  { to: "/app/transactions", label: "Transactions", icon: NavIconList, end: true },
  { to: "/app/exceptions", label: "Exceptions", icon: NavIconAlert },
  { to: "/app/counterparties", label: "Counterparties", icon: NavIconBuilding },
  { to: "/app/integrations", label: "Integrations", icon: NavIconPlug },
  { to: "/app/settings", label: "Settings", icon: NavIconGear },
];

export function AppShell() {
  const { user, workspace, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const wsRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const drawerWasOpen = useRef(false);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wsRef.current && !wsRef.current.contains(e.target as Node)) {
        setWsOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Unread notification indicator: cached like every other read, refreshed as
  // the user moves around, and invalidated the moment a notification is read
  // (invalidate("/api/notifications") covers this key too).
  const { data: unreadData, refetch: refetchUnread } = useQuery<{ unreadCount: number }>(
    "/api/notifications/unread-count",
    () => api.get<{ unreadCount: number }>("/api/notifications/unread-count")
  );
  const unreadNotifications = unreadData?.unreadCount ?? 0;

  useEffect(() => {
    refetchUnread();
  }, [location.pathname, refetchUnread]);

  // Mobile drawer: Escape closes, focus moves in on open and returns to the
  // trigger on close, and the background does not scroll behind the overlay.
  useEffect(() => {
    if (drawerOpen) {
      drawerWasOpen.current = true;
      document.body.style.overflow = "hidden";
      closeBtnRef.current?.focus();
      function onKey(e: KeyboardEvent) {
        if (e.key === "Escape") setDrawerOpen(false);
      }
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("keydown", onKey);
        document.body.style.overflow = "";
      };
    }
    document.body.style.overflow = "";
    if (drawerWasOpen.current) {
      drawerWasOpen.current = false;
      menuBtnRef.current?.focus();
    }
    return undefined;
  }, [drawerOpen]);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  const nav = (
    <nav aria-label="Main navigation" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `nav-item${isActive && (item.end ?? true) ? " active" : ""}`
          }
          onClick={() => setDrawerOpen(false)}
        >
          <item.icon />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="app-layout">
      {/* Desktop sidebar */}
      <aside className="sidebar">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div className="sidebar-brand">
            <Link to="/app/overview" className="brand-word">
              Nobryn
            </Link>
          </div>
          <NotificationsBell unread={unreadNotifications} />
        </div>
        <div className="workspace-selector" ref={wsRef}>
          <button
            type="button"
            className="workspace-btn"
            aria-haspopup="listbox"
            aria-expanded={wsOpen}
            onClick={() => setWsOpen((v) => !v)}
          >
            <span>{workspace?.name ?? "Workspace"}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M3 4.5L6 7.5L9 4.5" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {wsOpen ? (
            <div className="workspace-menu" role="listbox">
              <div style={{ padding: "8px 12px", fontSize: 13 }}>{workspace?.name}</div>
              <div style={{ padding: "0 12px 8px 12px", fontSize: 12, color: "#647067" }}>
                One workspace on this account
              </div>
            </div>
          ) : null}
        </div>
        {nav}
        <div className="sidebar-footer">
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            {user ? `${user.firstName} ${user.lastName}` : ""}
          </div>
          <div className="user-email" style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{user?.email}</div>
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={handleLogout}>
            Log out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="mobile-topbar">
        <Link to="/app/overview" className="brand-word" style={{ fontSize: 16 }}>
          Nobryn
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <NotificationsBell unread={unreadNotifications} />
          <button
            type="button"
            ref={menuBtnRef}
            className="menu-btn"
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path d="M3 5h14M3 10h14M3 15h14" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && setDrawerOpen(false)}>
          <div className="drawer" role="dialog" aria-label="Navigation">
            <div className="sidebar-brand" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div className="brand-word" style={{ fontSize: 16 }}>Nobryn</div>
              </div>
              <button type="button" ref={closeBtnRef} className="menu-btn" aria-label="Close navigation menu" onClick={() => setDrawerOpen(false)}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                  <path d="M4.5 4.5l9 9m0-9l-9 9" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="workspace-selector">
              <div className="workspace-btn" style={{ cursor: "default" }}>
                <span>{workspace?.name ?? "Workspace"}</span>
              </div>
            </div>
            {nav}
            <div className="sidebar-footer">
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {user ? `${user.firstName} ${user.lastName}` : ""}
              </div>
              <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={handleLogout}>
                Log out
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * Subtle unread indicator: a small bell linking to the notifications list.
 * The lime dot is a controlled accent — visible on the Bio Black shell, and
 * the unread count is always exposed to screen readers as text.
 */
function NotificationsBell({ unread }: { unread: number }) {
  return (
    <Link
      to="/app/notifications"
      className="menu-btn"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      style={{ position: "relative" }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
        <path
          d="M9 2.5c-2.2 0-4 1.8-4 4 0 3-1.25 4.25-1.25 4.25h10.5C13.25 10.75 12 9.5 12 6.5c0-2.2-1.8-4-3-4z"
          stroke="#FFFFFF"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M7.75 13.25a1.25 1.25 0 002.5 0" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      {unread > 0 ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 5,
            right: 5,
            width: 7,
            height: 7,
            borderRadius: 9999,
            background: "#C8FF00",
            border: "1px solid #FFFFFF",
          }}
        />
      ) : null}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// 18px line icons
// ---------------------------------------------------------------------------

function NavIconGrid() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10" y="2.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2.5" y="10" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10" y="10" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function NavIconList() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M6 4.5h9M6 9h9M6 13.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="3.2" cy="4.5" r="0.9" fill="currentColor" />
      <circle cx="3.2" cy="9" r="0.9" fill="currentColor" />
      <circle cx="3.2" cy="13.5" r="0.9" fill="currentColor" />
    </svg>
  );
}

function NavIconAlert() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M9 2.5L15.5 14.5H2.5L9 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9 7.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="9" cy="12.6" r="0.8" fill="currentColor" />
    </svg>
  );
}

function NavIconBuilding() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect x="3" y="2.5" width="12" height="13" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6.5 6h5M6.5 9h5M6.5 12h2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function NavIconPlug() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M6 2.5v4M12 2.5v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M4.5 6.5h9v2.5a4.5 4.5 0 01-9 0V6.5z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9 13.5v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function NavIconGear() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M9 2v2M9 14v2M2 9h2M14 9h2M4 4l1.4 1.4M12.6 12.6L14 14M14 4l-1.4 1.4M5.4 12.6L4 14"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
