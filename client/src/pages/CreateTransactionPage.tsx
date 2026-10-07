import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiClientError } from "../lib/api";
import { formatMoney } from "../lib/types";
import type { Counterparty, PolicyInfo } from "../lib/types";
import { useToast } from "../lib/toast";
import { Button, Field, Input, Select } from "../components/ui";

interface ItemDraft {
  name: string;
  quantity: string;
  unitPrice: string;
}

const EMPTY_ITEM: ItemDraft = { name: "", quantity: "", unitPrice: "" };

export default function CreateTransactionPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [counterparties, setCounterparties] = useState<Counterparty[] | null>(null);
  const [policies, setPolicies] = useState<PolicyInfo[]>([]);
  const [policyId, setPolicyId] = useState("");
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [newCounterparty, setNewCounterparty] = useState(false);
  const [cpCompanyName, setCpCompanyName] = useState("");
  const [cpContactName, setCpContactName] = useState("");
  const [cpEmail, setCpEmail] = useState("");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([{ ...EMPTY_ITEM }]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const total = useMemo(() => {
    return items.reduce((sum, item) => {
      const q = Number(item.quantity) || 0;
      const p = Number(item.unitPrice) || 0;
      return sum + q * p;
    }, 0);
  }, [items]);

  async function loadCounterparties() {
    try {
      const data = await api.get<Counterparty[]>("/api/counterparties");
      setCounterparties(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Unable to load counterparties.");
    }
  }

  useEffect(() => {
    void loadCounterparties();
    // Policy selection is optional: an empty value uses the workspace default.
    api
      .get<{ policies: PolicyInfo[] }>("/api/policies")
      .then((res) => setPolicies(res.policies))
      .catch(() => setPolicies([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!purchaseOrderNumber.trim()) errors.purchaseOrderNumber = "Purchase order number is required.";
    if (newCounterparty) {
      if (!cpCompanyName.trim()) errors.cpCompanyName = "Company name is required.";
      if (!cpContactName.trim()) errors.cpContactName = "Contact name is required.";
      if (!cpEmail.trim()) errors.cpEmail = "Email is required.";
      else if (!/^\S+@\S+\.\S+$/.test(cpEmail.trim()))
        errors.cpEmail = "A valid contact email is required.";
    } else if (!counterpartyId) {
      errors.counterpartyId = "Counterparty is required.";
    }
    if (!description.trim()) errors.description = "Description is required.";
    if (!amount || Number(amount) <= 0)
      errors.amount = Number(amount) <= 0 ? "Amount must be greater than zero." : "Transaction amount is required.";
    if (!expectedDeliveryDate) errors.expectedDeliveryDate = "Expected delivery date is required.";
    const cleaned = items.filter((i) => i.name.trim() || i.quantity || i.unitPrice);
    if (cleaned.length === 0) {
      errors.items = "At least one item is required.";
    } else {
      cleaned.forEach((item, idx) => {
        if (!item.name.trim()) errors[`item-${idx}-name`] = "Item name is required.";
        const q = Number(item.quantity);
        const p = Number(item.unitPrice);
        if (!item.quantity || q <= 0) errors[`item-${idx}-quantity`] = "Quantity must be greater than zero.";
        if (item.unitPrice === "" || Number.isNaN(p)) errors[`item-${idx}-unitPrice`] = "Unit price is required.";
        else if (p < 0) errors[`item-${idx}-unitPrice`] = "Unit price cannot be negative.";
      });
      if (cleaned.length > 0 && Math.abs(total - Number(amount || 0)) > 0.01) {
        errors.amount = "Amount must equal the total of all items.";
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      let cpId = counterpartyId;
      if (newCounterparty) {
        const created = await api.post<{ counterparty: { id: string } }>("/api/counterparties", {
          companyName: cpCompanyName.trim(),
          contactName: cpContactName.trim(),
          email: cpEmail.trim(),
        });
        cpId = created.counterparty.id;
      }
      const payloadItems = items
        .filter((i) => i.name.trim() || i.quantity || i.unitPrice)
        .map((i) => ({
          name: i.name.trim(),
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice),
        }));
      const res = await api.post<{ transaction: { id: string } }>("/api/transactions", {
        purchaseOrderNumber: purchaseOrderNumber.trim(),
        counterpartyId: cpId,
        description: description.trim(),
        amount: Number(amount),
        currency,
        expectedDeliveryDate,
        ...(policyId ? { policyId } : {}),
        items: payloadItems,
      });
      showToast({ title: "Transaction created" });
      navigate(`/app/transactions/${res.transaction.id}`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.details ?? {});
        showToast({ title: err.message, variant: "error" });
      } else {
        showToast({ title: "Transaction could not be created. Please try again.", variant: "error" });
      }
      setSubmitting(false);
    }
  }

  function updateItem(idx: number, key: keyof ItemDraft, value: string) {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [key]: value } : item)));
  }

  return (
    <div className="content-max form-max">
      <div className="page-header">
        <h1>Create transaction</h1>
        <p className="support">
          Create a purchase transaction and define what needs to be completed.
        </p>
      </div>

      {loadError ? (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <div role="alert" className="text-error" style={{ fontSize: 13 }}>
            {loadError}
          </div>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate>
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Field label="Purchase order number" htmlFor="po" error={fieldErrors.purchaseOrderNumber}>
            <Input
              id="po"
              value={purchaseOrderNumber}
              invalid={!!fieldErrors.purchaseOrderNumber}
              onChange={(e) => setPurchaseOrderNumber(e.target.value)}
              placeholder="PO-10483"
            />
          </Field>

          {!newCounterparty ? (
            <Field label="Counterparty" htmlFor="counterparty" error={fieldErrors.counterpartyId}>
              <div style={{ display: "flex", gap: 8 }}>
                <Select
                  id="counterparty"
                  value={counterpartyId}
                  invalid={!!fieldErrors.counterpartyId}
                  onChange={(e) => setCounterpartyId(e.target.value)}
                >
                  <option value="">Select a counterparty…</option>
                  {(counterparties ?? []).map((cp) => (
                    <option key={cp.id} value={cp.id}>
                      {cp.companyName}
                    </option>
                  ))}
                </Select>
              </div>
              <button
                type="button"
                className="text-12"
                style={{ color: "var(--ink)", fontWeight: 500, cursor: "pointer", background: "none", border: "none", padding: 0, textAlign: "left" }}
                onClick={() => setNewCounterparty(true)}
              >
                + Create new counterparty
              </button>
            </Field>
          ) : (
            <>
              <Field label="Company name" htmlFor="cp-company" error={fieldErrors.cpCompanyName}>
                <Input
                  id="cp-company"
                  value={cpCompanyName}
                  invalid={!!fieldErrors.cpCompanyName}
                  onChange={(e) => setCpCompanyName(e.target.value)}
                />
              </Field>
              <Field label="Contact name" htmlFor="cp-contact" error={fieldErrors.cpContactName}>
                <Input
                  id="cp-contact"
                  value={cpContactName}
                  invalid={!!fieldErrors.cpContactName}
                  onChange={(e) => setCpContactName(e.target.value)}
                />
              </Field>
              <Field label="Email" htmlFor="cp-email" error={fieldErrors.cpEmail}>
                <Input
                  id="cp-email"
                  type="email"
                  value={cpEmail}
                  invalid={!!fieldErrors.cpEmail}
                  onChange={(e) => setCpEmail(e.target.value)}
                />
              </Field>
              <button
                type="button"
                className="text-12"
                style={{ color: "var(--ink)", fontWeight: 500, cursor: "pointer", background: "none", border: "none", padding: 0, textAlign: "left" }}
                onClick={() => setNewCounterparty(false)}
              >
                ← Choose an existing counterparty
              </button>
            </>
          )}

          <Field label="Description" htmlFor="description" error={fieldErrors.description}>
            <Input
              id="description"
              value={description}
              invalid={!!fieldErrors.description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Industrial components for warehouse inventory"
            />
          </Field>

          <div className="grid-currency">
            <Field label="Currency" htmlFor="currency">
              <Select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="CHF">CHF</option>
              </Select>
            </Field>
            <Field label="Transaction amount" htmlFor="amount" error={fieldErrors.amount}>
              <Input
                id="amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                invalid={!!fieldErrors.amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Expected delivery date" htmlFor="delivery" error={fieldErrors.expectedDeliveryDate}>
              <Input
                id="delivery"
                type="date"
                value={expectedDeliveryDate}
                invalid={!!fieldErrors.expectedDeliveryDate}
                onChange={(e) => setExpectedDeliveryDate(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Execution policy" htmlFor="policy">
            <Select id="policy" value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
              <option value="">Default policy</option>
              {policies.map((policy) => (
                <option key={policy.id ?? policy.name} value={policy.id ?? ""}>
                  {policy.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Items */}
        <div className="card card-pad" style={{ marginTop: 16 }}>
          <h2 className="card-heading" style={{ marginBottom: 4 }}>
            Items
          </h2>
          <p className="text-12 text-muted" style={{ margin: "0 0 16px 0" }}>
            At least one item is required. The transaction amount must equal the item total.
          </p>
          {fieldErrors.items ? (
            <div role="alert" className="field-error" style={{ marginBottom: 8 }}>
              {fieldErrors.items}
            </div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {items.map((item, idx) => (
              <div key={idx} className="grid-items">
                <Field label="Item name" htmlFor={`item-${idx}-name`} error={fieldErrors[`item-${idx}-name`]}>
                  <Input
                    id={`item-${idx}-name`}
                    value={item.name}
                    invalid={!!fieldErrors[`item-${idx}-name`]}
                    onChange={(e) => updateItem(idx, "name", e.target.value)}
                    placeholder="Precision drive assembly"
                  />
                </Field>
                <Field label="Quantity" htmlFor={`item-${idx}-qty`} error={fieldErrors[`item-${idx}-quantity`]}>
                  <Input
                    id={`item-${idx}-qty`}
                    type="number"
                    min="1"
                    step="1"
                    value={item.quantity}
                    invalid={!!fieldErrors[`item-${idx}-quantity`]}
                    onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                  />
                </Field>
                <Field label="Unit price" htmlFor={`item-${idx}-price`} error={fieldErrors[`item-${idx}-unitPrice`]}>
                  <Input
                    id={`item-${idx}-price`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitPrice}
                    invalid={!!fieldErrors[`item-${idx}-unitPrice`]}
                    onChange={(e) => updateItem(idx, "unitPrice", e.target.value)}
                  />
                </Field>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, flexWrap: "wrap", gap: 12 }}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])}
            >
              Add item
            </Button>
            <div style={{ textAlign: "right" }}>
              <div className="text-12 text-muted">Total</div>
              <div style={{ fontSize: 16, fontWeight: 600 }} className="mono">
                {formatMoney(total, currency)} {currency}
              </div>
            </div>
          </div>
        </div>

        <div className="form-actions">
          <Link to="/app/transactions" className="btn btn-secondary">
            Cancel
          </Link>
          <Button type="submit" loading={submitting} loadingText="Creating transaction...">
            Create transaction
          </Button>
        </div>
      </form>
    </div>
  );
}
