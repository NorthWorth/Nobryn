import { useState } from "react";
import { Button, Modal } from "../components/ui";
import { EVENT_SOURCE_GROUPS } from "../lib/types";
import { useToast } from "../lib/toast";

interface Integration {
  key: string;
  name: string;
  source: string;
  description: string;
  status: "Connected" | "Simulated connection";
}

const INTEGRATIONS: Integration[] = [
  {
    key: "supplier-api",
    name: "Supplier API",
    source: "Supplier API",
    description:
      "Supplier confirmations, fulfillment started, delivery reports and timeout notices.",
    status: "Simulated connection",
  },
  {
    key: "warehouse",
    name: "Warehouse system",
    source: "Warehouse system",
    description:
      "Goods received, delivery reports and the quantities actually received.",
    status: "Simulated connection",
  },
  {
    key: "logistics",
    name: "Logistics provider",
    source: "Logistics provider",
    description:
      "Shipment creation, dispatch, transit updates, delays and delivery.",
    status: "Simulated connection",
  },
  {
    key: "erp",
    name: "ERP",
    source: "ERP",
    description:
      "Purchase order creation, synchronization and purchase order updates.",
    status: "Simulated connection",
  },
];

function eventsFor(source: string): string[] {
  return (
    EVENT_SOURCE_GROUPS.find((group) => group.source === source)?.events.map(
      (event) => event.label
    ) ?? []
  );
}

export default function IntegrationsPage() {
  const { showToast } = useToast();
  const [configuring, setConfiguring] = useState<Integration | null>(null);

  return (
    <div className="content-max form-max" style={{ maxWidth: 880 }}>
      <div className="page-header">
        <h1>Integrations</h1>
        <p className="support">
          External systems report claims and events into Nobryn. Nobryn verifies what requires
          confirmation, reconciles it against the transaction, and only then updates state —
          opening an exception when reality does not match expectations.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))",
          gap: 16,
        }}
      >
        {INTEGRATIONS.map((integration) => (
          <div key={integration.key} className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <h2 className="card-heading">{integration.name}</h2>
              <span className={`badge ${integration.status === "Connected" ? "badge-success" : "badge-info"}`}>
                <span className="dot" aria-hidden />
                {integration.status}
              </span>
            </div>
            <p className="text-muted" style={{ margin: 0, fontSize: 14 }}>
              {integration.description}
            </p>
            <div>
              <div className="text-12 text-muted" style={{ fontWeight: 500 }}>
                Events
              </div>
              <ul
                style={{
                  listStyle: "none",
                  margin: "4px 0 0 0",
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                {eventsFor(integration.source).map((event) => (
                  <li key={event} className="text-13" style={{ color: "#475569" }}>
                    · {event}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <Button variant="secondary" onClick={() => setConfiguring(integration)}>
                Configure
              </Button>
            </div>
          </div>
        ))}
      </div>

      {configuring ? (
        <Modal
          title={`Configure ${configuring.name}`}
          description="Simulated source: events enter the same ingestion pipeline a future real integration will use — claims are recorded, verified where required, reconciled, and only then reflected in transaction state."
          onClose={() => setConfiguring(null)}
        >
          <div className="meta-row">
            <span className="meta-label">Connection</span>
            <span className="meta-value">{configuring.status}</span>
          </div>
          <div className="meta-row">
            <span className="meta-label">Events</span>
            <span className="meta-value">{eventsFor(configuring.source).join(", ")}</span>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={() => setConfiguring(null)}>
              Cancel
            </button>
            <Button
              onClick={() => {
                setConfiguring(null);
                showToast({
                  title: "Integration settings saved",
                  description: `${configuring.name} continues to publish simulated events through the Nobryn ingestion pipeline.`,
                });
              }}
            >
              Save
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
