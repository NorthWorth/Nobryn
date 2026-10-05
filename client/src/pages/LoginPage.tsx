import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiClientError } from "../lib/api";
import { Button, Field, Input } from "../components/ui";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const returnTo = searchParams.get("returnTo") || "/app/overview";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const errors: Record<string, string> = {};
    if (!email.trim()) errors.email = "Email is required.";
    if (!password) errors.password = "Password is required.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(returnTo.startsWith("/app") ? returnTo : "/app/overview", { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message);
      } else {
        setFormError("Sign in failed. Please try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Log in to Nobryn" subtitle="Access your business transactions.">
      <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {formError ? (
          <div role="alert" className="card" style={{ padding: "10px 12px", borderColor: "#FECACA", background: "#FEF2F2", fontSize: 13, color: "#B91C1C" }}>
            {formError}
          </div>
        ) : null}
        <Field label="Email" htmlFor="email" error={fieldErrors.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            invalid={!!fieldErrors.email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </Field>
        <Field label="Password" htmlFor="password" error={fieldErrors.password}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            invalid={!!fieldErrors.password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        <Button type="submit" loading={submitting} loadingText="Signing in...">
          Log in
        </Button>
      </form>
      <p className="text-muted" style={{ fontSize: 13, textAlign: "center", margin: "16px 0 0 0" }}>
        No account?{" "}
        <Link to="/register" style={{ color: "#2563EB", fontWeight: 500 }}>
          Create one
        </Link>
      </p>
    </AuthLayout>
  );
}

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "24px 32px" }}>
        <Link to="/">
          <span style={{ fontSize: 17, fontWeight: 600 }}>Nobryn</span>
        </Link>
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 16px" }}>
        <div className="card card-pad" style={{ width: "100%", maxWidth: 400 }}>
          <h1 style={{ fontSize: 20, lineHeight: "28px", fontWeight: 600, margin: 0 }}>{title}</h1>
          <p className="text-muted" style={{ margin: "8px 0 24px 0", fontSize: 14 }}>
            {subtitle}
          </p>
          {children}
        </div>
      </div>
    </div>
  );
}
