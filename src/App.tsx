import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { ToastProvider } from "./lib/toast";
import { AppShell } from "./components/AppShell";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import OverviewPage from "./pages/OverviewPage";
import TransactionsPage from "./pages/TransactionsPage";
import CreateTransactionPage from "./pages/CreateTransactionPage";
import TransactionDetailPage from "./pages/TransactionDetailPage";
import ExceptionsPage from "./pages/ExceptionsPage";
import CounterpartiesPage from "./pages/CounterpartiesPage";
import IntegrationsPage from "./pages/IntegrationsPage";
import SettingsPage from "./pages/SettingsPage";
import type { ReactNode } from "react";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span className="skeleton" style={{ width: 160, height: 20 }} />
      </div>
    );
  }
  if (!user) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth?returnTo=${returnTo}`} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/auth" element={<AuthRouter />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/app"
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/app/overview" replace />} />
            <Route path="overview" element={<OverviewPage />} />
            <Route path="transactions" element={<TransactionsPage />} />
            <Route path="transactions/new" element={<CreateTransactionPage />} />
            <Route path="transactions/:transactionId" element={<TransactionDetailPage />} />
            <Route path="exceptions" element={<ExceptionsPage />} />
            <Route path="counterparties" element={<CounterpartiesPage />} />
            <Route path="integrations" element={<IntegrationsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}

/**
 * Keeps /auth working as the canonical sign-in entry point by redirecting to
 * /login (preserving any returnTo parameter).
 */
function AuthRouter() {
  const location = useLocation();
  const search = location.search;
  return <Navigate to={`/login${search}`} replace />;
}
