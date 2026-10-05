import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiClientError } from "../lib/api";
import { Button, Field, Input } from "../components/ui";
import { AuthLayout } from "./LoginPage";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    workspaceName: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const errors: Record<string, string> = {};
    if (!form.firstName.trim()) errors.firstName = "First name is required.";
    if (!form.lastName.trim()) errors.lastName = "Last name is required.";
    if (!form.email.trim()) errors.email = "Email is required.";
    else if (!/^\S+@\S+\.\S+$/.test(form.email.trim()))
      errors.email = "A valid email address is required.";
    if (form.password.length < 8) errors.password = "Password must be at least 8 characters.";
    if (!form.workspaceName.trim()) errors.workspaceName = "Workspace name is required.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSubmitting(true);
    try {
      await register({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        password: form.password,
        workspaceName: form.workspaceName.trim(),
      });
      navigate("/app/overview", { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.details ?? {});
        setFormError(err.message);
      } else {
        setFormError("Registration failed. Please try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Create your workspace" subtitle="One account. One workspace. Start executing transactions.">
      <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {formError ? (
          <div role="alert" className="card" style={{ padding: "10px 12px", borderColor: "#FECACA", background: "#FEF2F2", fontSize: 13, color: "#B91C1C" }}>
            {formError}
          </div>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Field label="First name" htmlFor="firstName" error={fieldErrors.firstName}>
            <Input
              id="firstName"
              value={form.firstName}
              invalid={!!fieldErrors.firstName}
              onChange={(e) => update("firstName", e.target.value)}
              autoComplete="given-name"
            />
          </Field>
          <Field label="Last name" htmlFor="lastName" error={fieldErrors.lastName}>
            <Input
              id="lastName"
              value={form.lastName}
              invalid={!!fieldErrors.lastName}
              onChange={(e) => update("lastName", e.target.value)}
              autoComplete="family-name"
            />
          </Field>
        </div>
        <Field label="Email" htmlFor="reg-email" error={fieldErrors.email}>
          <Input
            id="reg-email"
            type="email"
            autoComplete="email"
            value={form.email}
            invalid={!!fieldErrors.email}
            onChange={(e) => update("email", e.target.value)}
          />
        </Field>
        <Field label="Password" htmlFor="reg-password" error={fieldErrors.password}>
          <Input
            id="reg-password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            invalid={!!fieldErrors.password}
            onChange={(e) => update("password", e.target.value)}
          />
          <span className="text-12 text-subtle">At least 8 characters.</span>
        </Field>
        <Field label="Workspace name" htmlFor="workspaceName" error={fieldErrors.workspaceName}>
          <Input
            id="workspaceName"
            value={form.workspaceName}
            invalid={!!fieldErrors.workspaceName}
            onChange={(e) => update("workspaceName", e.target.value)}
            placeholder="Your company name"
          />
        </Field>
        <Button type="submit" loading={submitting} loadingText="Creating workspace...">
          Create workspace
        </Button>
      </form>
      <p className="text-muted" style={{ fontSize: 13, textAlign: "center", margin: "16px 0 0 0" }}>
        Already have an account?{" "}
        <Link to="/login" style={{ color: "#2563EB", fontWeight: 500 }}>
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
