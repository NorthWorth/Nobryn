import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "../lib/api";
import { formatDate } from "../lib/types";
import type { Counterparty } from "../lib/types";
import { useToast } from "../lib/toast";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  TableSkeleton,
} from "../components/ui";

export default function CounterpartiesPage() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<Counterparty[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get<Counterparty[]>("/api/counterparties");
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="content-max" style={{ maxWidth: "none" }}>
      <div className="page-header page-header-row">
        <div>
          <h1>Counterparties</h1>
          <p className="support">Organizations involved in your business transactions.</p>
        </div>
        <Button onClick={() => setModalOpen(true)}>Add counterparty</Button>
      </div>

      {error ? (
        <div className="card">
          <ErrorState
            title="Unable to load counterparties"
            message="We couldn't retrieve counterparties from the transaction service."
            onRetry={() => void load()}
          />
        </div>
      ) : rows === null ? (
        <TableSkeleton rows={5} cols={5} />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No counterparties"
            description="Add a counterparty to begin creating business transactions."
            action={<Button onClick={() => setModalOpen(true)}>Add counterparty</Button>}
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="nbt">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Transactions</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((cp) => (
                <tr key={cp.id}>
                  <td style={{ fontWeight: 500 }}>{cp.companyName}</td>
                  <td>{cp.contactName}</td>
                  <td className="text-muted">{cp.email}</td>
                  <td className="mono">{cp.transactionCount}</td>
                  <td className="text-12 text-muted">
                    {cp.lastActivity ? formatDate(cp.lastActivity) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen ? (
        <AddCounterpartyModal
          onClose={() => setModalOpen(false)}
          onCreated={async () => {
            setModalOpen(false);
            showToast({ title: "Counterparty added" });
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function AddCounterpartyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    const errors: Record<string, string> = {};
    if (!companyName.trim()) errors.companyName = "Company name is required.";
    if (!contactName.trim()) errors.contactName = "Contact name is required.";
    if (!email.trim()) errors.email = "Email is required.";
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = "A valid contact email is required.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      await api.post("/api/counterparties", {
        companyName: companyName.trim(),
        contactName: contactName.trim(),
        email: email.trim(),
      });
      await onCreated();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.details ?? {});
      } else {
        setFieldErrors({ form: "Could not add the counterparty. Please try again." });
      }
      setSaving(false);
    }
  }

  return (
    <Modal title="Add counterparty" description="Create an organization involved in your transactions." onClose={onClose}>
      {fieldErrors.form ? (
        <div role="alert" className="text-error text-13" style={{ fontSize: 13 }}>
          {fieldErrors.form}
        </div>
      ) : null}
      <Field label="Company name" htmlFor="cp-name" error={fieldErrors.companyName}>
        <Input
          id="cp-name"
          value={companyName}
          invalid={!!fieldErrors.companyName}
          onChange={(e) => setCompanyName(e.target.value)}
        />
      </Field>
      <Field label="Contact name" htmlFor="cp-contact" error={fieldErrors.contactName}>
        <Input
          id="cp-contact"
          value={contactName}
          invalid={!!fieldErrors.contactName}
          onChange={(e) => setContactName(e.target.value)}
        />
      </Field>
      <Field label="Email" htmlFor="cp-email" error={fieldErrors.email}>
        <Input
          id="cp-email"
          type="email"
          value={email}
          invalid={!!fieldErrors.email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <Button onClick={() => void handleSubmit()} loading={saving} loadingText="Saving...">
          Add counterparty
        </Button>
      </div>
    </Modal>
  );
}
