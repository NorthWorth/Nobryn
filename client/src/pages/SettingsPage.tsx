import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, ApiClientError } from "../lib/api";
import { invalidate, useQuery } from "../lib/query";
import type { PolicyInfo } from "../lib/types";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { Button, Field, Input, Modal, Select } from "../components/ui";

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
  const [policyModal, setPolicyModal] = useState<PolicyInfo | null | undefined>(undefined);

  // Policies are configuration: cached for a minute and revalidated in the
  // background, so this page paints instantly on repeat visits.
  const { data: policiesResponse, error: policiesError, refetch: loadPolicies } = useQuery<{
    policies: PolicyInfo[];
  }>(
    "/api/policies",
    () => api.get<{ policies: PolicyInfo[] }>("/api/policies"),
    { staleTime: 60_000 }
  );
  const policies = policiesResponse?.policies ?? null;

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

      <section className="card card-pad" aria-label="Transaction policies" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 8,
          }}
        >
          <h2 className="card-heading">Transaction policies</h2>
          <Button variant="secondary" onClick={() => setPolicyModal(null)}>
            New policy
          </Button>
        </div>
        <p className="text-12 text-muted" style={{ margin: "0 0 16px 0" }}>
          Policies define how transactions verify, reconcile and complete. New transactions
          execute under the selected policy.
        </p>
        {policiesError && policies === null ? (
          <div role="alert" style={{ fontSize: 13 }}>
            <span className="text-error">
              {policiesError instanceof Error
                ? policiesError.message
                : "Unable to load transaction policies."}
            </span>{" "}
            <button
              type="button"
              className="text-12"
              style={{
                color: "var(--ink)",
                fontWeight: 500,
                cursor: "pointer",
                background: "none",
                border: "none",
                padding: 0,
              }}
              onClick={() => loadPolicies()}
            >
              Try again
            </button>
          </div>
        ) : policies === null ? (
          <span
            className="skeleton"
            style={{ display: "block", width: "60%", height: 16 }}
            aria-hidden
          />
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {policies.map((policy) => (
              <li
                key={policy.id ?? policy.name}
                style={{
                  border: "1px solid #D9E0DC",
                  background: "var(--soft-chrome)",
                  borderRadius: 6,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontWeight: 500, fontSize: 14 }}>{policy.name}</span>
                  <Button variant="secondary" onClick={() => setPolicyModal(policy)}>
                    Edit
                  </Button>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: 12,
                    marginTop: 12,
                  }}
                >
                  <PolicyFact
                    label="Delivery confirmation"
                    value={policy.deliveryConfirmationRequired ? "Required" : "Not required"}
                  />
                  <PolicyFact
                    label="Quantity reconciliation"
                    value={policy.quantityReconciliationRequired ? "Required" : "Not required"}
                  />
                  <PolicyFact label="Quantity tolerance" value={`${policy.quantityTolerance} units`} />
                  <PolicyFact
                    label="Confirmation window"
                    value={`${policy.confirmationWindowHours} hours`}
                  />
                  <PolicyFact
                    label="Blocking mismatches"
                    value={policy.blockingMismatches ? "Yes" : "No"}
                  />
                </div>
                <div className="text-12 text-muted" style={{ marginTop: 10 }}>
                  Completion: {policy.completionCondition}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card card-pad" aria-label="Account settings">
        <h2 className="card-heading" style={{ marginBottom: 16 }}>
          Account
        </h2>
        <form onSubmit={saveAccount} noValidate style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
          <div className="grid-2">
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

      {policyModal !== undefined ? (
        <PolicyModal
          policy={policyModal}
          onClose={() => setPolicyModal(undefined)}
          onSaved={async () => {
            setPolicyModal(undefined);
            showToast({ title: "Policy saved" });
            invalidate("/api/policies");
          }}
        />
      ) : null}
    </div>
  );
}

function PolicyFact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="text-12 text-muted">{label}</div>
      <div style={{ fontSize: 13, overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}

/** Create/edit a transaction policy — validated client-side and server-side. */
function PolicyModal({
  policy,
  onClose,
  onSaved,
}: {
  policy: PolicyInfo | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(policy?.name ?? "");
  const [deliveryRequired, setDeliveryRequired] = useState(
    policy?.deliveryConfirmationRequired ?? true
  );
  const [reconciliationRequired, setReconciliationRequired] = useState(
    policy?.quantityReconciliationRequired ?? true
  );
  const [tolerance, setTolerance] = useState(String(policy?.quantityTolerance ?? 0));
  const [windowHours, setWindowHours] = useState(
    String(policy?.confirmationWindowHours ?? 24)
  );
  const [blockingMismatches, setBlockingMismatches] = useState(
    policy?.blockingMismatches ?? true
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Policy name is required.";
    const parsedTolerance = Number(tolerance);
    if (tolerance === "" || Number.isNaN(parsedTolerance) || parsedTolerance < 0) {
      next.quantityTolerance = "Tolerance cannot be negative.";
    }
    const parsedWindow = Number(windowHours);
    if (!Number.isInteger(parsedWindow) || parsedWindow < 1) {
      next.confirmationWindowHours = "Enter a whole number of hours (at least 1).";
    }
    setFieldErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    const payload = {
      name: name.trim(),
      deliveryConfirmationRequired: deliveryRequired,
      quantityReconciliationRequired: reconciliationRequired,
      quantityTolerance: parsedTolerance,
      confirmationWindowHours: parsedWindow,
      blockingMismatches,
    };
    try {
      if (policy?.id) {
        await api.patch(`/api/policies/${policy.id}`, payload);
      } else {
        await api.post("/api/policies", payload);
      }
      await onSaved();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors({ ...(err.details ?? {}), form: err.message });
      } else {
        setFieldErrors({ form: "Could not save the policy. Please try again." });
      }
      setSaving(false);
    }
  }

  return (
    <Modal
      title={policy?.id ? "Edit policy" : "New policy"}
      description="Policies drive verification, reconciliation and completion behavior."
      onClose={onClose}
    >
      <Field label="Policy name" htmlFor="policy-name" error={fieldErrors.name}>
        <Input
          id="policy-name"
          value={name}
          invalid={!!fieldErrors.name}
          onChange={(e) => {
            setName(e.target.value);
            setFieldErrors((prev) => ({ ...prev, name: "" }));
          }}
        />
      </Field>
      <div className="grid-2">
        <Field label="Delivery confirmation" htmlFor="policy-delivery">
          <Select
            id="policy-delivery"
            value={deliveryRequired ? "yes" : "no"}
            onChange={(e) => setDeliveryRequired(e.target.value === "yes")}
          >
            <option value="yes">Required</option>
            <option value="no">Not required</option>
          </Select>
        </Field>
        <Field label="Quantity reconciliation" htmlFor="policy-reconciliation">
          <Select
            id="policy-reconciliation"
            value={reconciliationRequired ? "yes" : "no"}
            onChange={(e) => setReconciliationRequired(e.target.value === "yes")}
          >
            <option value="yes">Required</option>
            <option value="no">Not required</option>
          </Select>
        </Field>
        <Field
          label="Quantity tolerance (units)"
          htmlFor="policy-tolerance"
          error={fieldErrors.quantityTolerance}
        >
          <Input
            id="policy-tolerance"
            type="number"
            min="0"
            step="1"
            value={tolerance}
            invalid={!!fieldErrors.quantityTolerance}
            onChange={(e) => {
              setTolerance(e.target.value);
              setFieldErrors((prev) => ({ ...prev, quantityTolerance: "" }));
            }}
          />
        </Field>
        <Field
          label="Confirmation window (hours)"
          htmlFor="policy-window"
          error={fieldErrors.confirmationWindowHours}
        >
          <Input
            id="policy-window"
            type="number"
            min="1"
            step="1"
            value={windowHours}
            invalid={!!fieldErrors.confirmationWindowHours}
            onChange={(e) => {
              setWindowHours(e.target.value);
              setFieldErrors((prev) => ({ ...prev, confirmationWindowHours: "" }));
            }}
          />
        </Field>
      </div>
      <Field label="Blocking mismatches" htmlFor="policy-blocking">
        <Select
          id="policy-blocking"
          value={blockingMismatches ? "yes" : "no"}
          onChange={(e) => setBlockingMismatches(e.target.value === "yes")}
        >
          <option value="yes">Yes — mismatches block completion</option>
          <option value="no">No — mismatches do not block</option>
        </Select>
      </Field>
      {fieldErrors.form ? (
        <span className="field-error" role="alert">
          {fieldErrors.form}
        </span>
      ) : null}
      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <Button onClick={() => void save()} loading={saving} loadingText="Saving policy...">
          {policy?.id ? "Save policy" : "Create policy"}
        </Button>
      </div>
    </Modal>
  );
}


