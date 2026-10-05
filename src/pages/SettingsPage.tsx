import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { Button, Field, Input } from "../components/ui";

export default function SettingsPage() {
  const { user, workspace, setWorkspace, setUser } = useAuth();
  const { showToast } = useToast();
  const [workspaceName, setWorkspaceName] = useState(workspace?.name ?? "");
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [email] = useState(user?.email ?? "");
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (workspace) setWorkspaceName(workspace.name);
  }, [workspace]);

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName);
      setLastName(user.lastName);
    }
  }, [user]);

  async function saveWorkspace(e: FormEvent) {
    e.preventDefault();
    if (!workspaceName.trim()) {
      setErrors({ workspaceName: "Workspace name is required." });
      return;
    }
    setSavingWorkspace(true);
    setErrors({});
    try {
      const res = await api.patch<{ workspace: { id: string; name: string } }>("/api/workspace", {
        name: workspaceName.trim(),
      });
      setWorkspace(res.workspace);
      showToast({ title: "Settings saved" });
    } catch (err) {
      showToast({
        title: err instanceof ApiClientError ? err.message : "Could not save settings.",
        variant: "error",
      });
    } finally {
      setSavingWorkspace(false);
    }
  }

  async function saveAccount(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!firstName.trim()) next.firstName = "First name is required.";
    if (!lastName.trim()) next.lastName = "Last name is required.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSavingAccount(true);
    try {
      const res = await api.patch<{ user: { id: string; firstName: string; lastName: string; email: string } }>(
        "/api/account",
        { firstName: firstName.trim(), lastName: lastName.trim() }
      );
      setUser(res.user);
      showToast({ title: "Settings saved" });
    } catch (err) {
      showToast({
        title: err instanceof ApiClientError ? err.message : "Could not save settings.",
        variant: "error",
      });
    } finally {
      setSavingAccount(false);
    }
  }

  return (
    <div className="content-max form-max">
      <div className="page-header">
        <h1>Settings</h1>
        <p className="support">Workspace and account configuration.</p>
      </div>

      <section className="card card-pad" aria-label="Workspace settings" style={{ marginBottom: 16 }}>
        <h2 className="card-heading" style={{ marginBottom: 16 }}>
          Workspace
        </h2>
        <form onSubmit={saveWorkspace} noValidate style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
          <Field label="Workspace name" htmlFor="ws-name" error={errors.workspaceName}>
            <Input
              id="ws-name"
              value={workspaceName}
              invalid={!!errors.workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" loading={savingWorkspace} loadingText="Saving...">
              Save changes
            </Button>
          </div>
        </form>
      </section>

      <section className="card card-pad" aria-label="Account settings">
        <h2 className="card-heading" style={{ marginBottom: 16 }}>
          Account
        </h2>
        <form onSubmit={saveAccount} noValidate style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Field label="First name" htmlFor="acc-first" error={errors.firstName}>
              <Input
                id="acc-first"
                value={firstName}
                invalid={!!errors.firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </Field>
            <Field label="Last name" htmlFor="acc-last" error={errors.lastName}>
              <Input
                id="acc-last"
                value={lastName}
                invalid={!!errors.lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Email" htmlFor="acc-email">
            <Input id="acc-email" value={email} disabled aria-readonly />
          </Field>
          <div>
            <Button type="submit" loading={savingAccount} loadingText="Saving...">
              Save changes
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
