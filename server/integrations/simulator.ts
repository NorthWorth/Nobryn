/**
 * The simulator is the MVP's event source: a controlled adapter that emits
 * normalized events through the exact pipeline future real integrations will
 * use. Simulated functionality is always labelled as simulated in the UI.
 */
import { EVENT_CATALOG } from "../domain.js";
import type { ExternalEventType } from "../domain.js";
import { ApiError } from "../errors.js";
import type { IntegrationAdapter, NormalizedEvent } from "./types.js";

export interface SimulatorAction {
  source: string;
  type: ExternalEventType;
  label: string;
  /** Preset claim quantity, where the simulated source reports one. */
  reportedQuantity?: number;
}

/** Controlled simulator capabilities, grouped by external source. */
export const SIMULATOR_ACTIONS: SimulatorAction[] = [
  // Supplier API
  { source: "Supplier API", type: "SUPPLIER_CONFIRMATION", label: "Accept order" },
  { source: "Supplier API", type: "FULFILLMENT_STARTED", label: "Start fulfillment" },
  { source: "Supplier API", type: "DELIVERY_REPORTED", label: "Report delivery" },
  { source: "Supplier API", type: "SUPPLIER_TIMEOUT", label: "Report supplier timeout" },
  // Warehouse system
  { source: "Warehouse system", type: "DELIVERY_REPORTED", label: "Report delivery (goods received)" },
  { source: "Warehouse system", type: "DELIVERY_REPORTED", label: "Report 500 units received", reportedQuantity: 500 },
  { source: "Warehouse system", type: "DELIVERY_REPORTED", label: "Report 470 units received (quantity mismatch)", reportedQuantity: 470 },
  // Logistics provider
  { source: "Logistics provider", type: "SHIPMENT_CREATED", label: "Create shipment" },
  { source: "Logistics provider", type: "SHIPMENT_DISPATCHED", label: "Dispatch shipment" },
  { source: "Logistics provider", type: "SHIPMENT_IN_TRANSIT", label: "Mark in transit" },
  { source: "Logistics provider", type: "DELIVERY_DELAYED", label: "Report delay" },
  { source: "Logistics provider", type: "DELIVERY_REPORTED", label: "Report delivery" },
  // ERP
  { source: "ERP", type: "PO_CREATED", label: "Create purchase order" },
  { source: "ERP", type: "PO_SYNCED", label: "Synchronize purchase order" },
  { source: "ERP", type: "PO_UPDATED", label: "Update purchase order" },
];

export const simulatorAdapter: IntegrationAdapter = {
  key: "simulator",
  label: "Simulated integrations",
  simulated: true,
  normalize(input: unknown): NormalizedEvent {
    const raw = input as {
      type?: ExternalEventType;
      source?: string;
      eventId?: string;
      reportedQuantity?: number;
    };
    if (!raw?.type || !EVENT_CATALOG[raw.type]) {
      throw new ApiError(400, "Unknown event type.");
    }
    const def = EVENT_CATALOG[raw.type];
    if (raw.source && !def.sources.includes(raw.source)) {
      throw new ApiError(
        400,
        `The ${raw.source} cannot produce a ${def.label} event.`,
        { source: `This source cannot produce ${def.label}.` }
      );
    }
    const source = raw.source ?? def.source;

    // The simulator may only emit actions it actually declares.
    const producible = SIMULATOR_ACTIONS.some(
      (action) => action.type === raw.type && action.source === source
    );
    if (!producible) {
      throw new ApiError(
        400,
        `The simulated ${source} cannot produce a ${def.label} event.`,
        { source: `This source cannot produce ${def.label}.` }
      );
    }

    return {
      type: raw.type,
      source,
      ...(raw.eventId ? { eventId: raw.eventId } : {}),
      ...(raw.reportedQuantity != null ? { reportedQuantity: raw.reportedQuantity } : {}),
    };
  },
};
