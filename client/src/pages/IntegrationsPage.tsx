import { useState } from "react";
import { Button, Modal } from "../components/ui";
import { useToast } from "../lib/toast";

interface Integration {
  key: string;
  name: string;
  description: string;
  status: "Connected" | "Simulated connection";
}

const INTEGRATIONS: Integration[] = [
  {
    key: "supplier-api",
    name: "Supplier API",
    description: "Receive supplier confirmations and fulfillment events.",
    status: "Simulated connection",
  },
  {
    key: "warehouse",
    name: "Warehouse system",
    description: "Capture delivery confirmations and received quantities.",
    status: "Simulated connection",
  },
  {
    key: "logistics",
    name: "Logistics provider",
    description: "Track shipment events between dispatch and delivery.",
    status: "Simulated connection",
  },
  {
    key: "erp",
    name: "ERP",
    description: "Synchronize purchase orders with your ERP records.",
    status: "Simulated connection",
  },
];

export default function IntegrationsPage() {
  const { showToast } = useToast();
  const [configuring, setConfiguring] = useState<Integration | null>(null);

  return (
    <div className="content-max form-max" style={{ maxWidth: 880 }}>
      <div className="page-header">
        <h1>Integrations</h1>
        <p className="support">
          Connect the systems that provide transaction events and evidence.
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
          description="This integration is provided by the Nobryn execution engine and requires no external configuration."
          onClose={() => setConfiguring(null)}
        >
          <div className="meta-row">
            <span className="meta-label">Connection</span>
            <span className="meta-value">{configuring.status}</span>
          </div>
          <div className="meta-row">
            <span className="meta-label">Events</span>
            <span className="meta-value">Confirmations, fulfillment, delivery</span>
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
                  description: `${configuring.name} remains connected via the Nobryn execution engine.`,
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
