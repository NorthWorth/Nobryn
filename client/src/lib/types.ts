export type TransactionState =
  | "CREATED"
  | "ACCEPTED"
  | "FULFILLING"
  | "DELIVERED"
  | "COMPLETED";

export type ExceptionType = "SUPPLIER_TIMEOUT" | "DELIVERY_DELAY" | "QUANTITY_MISMATCH";

export type ExceptionStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";

export const STATE_ORDER: TransactionState[] = [
  "CREATED",
  "ACCEPTED",
  "FULFILLING",
  "DELIVERED",
  "COMPLETED",
];

export const STATE_LABELS: Record<TransactionState, string> = {
  CREATED: "Created",
  ACCEPTED: "Accepted",
  FULFILLING: "Fulfilling",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
};

export const NEXT_STATE: Record<TransactionState, TransactionState | null> = {
  CREATED: "ACCEPTED",
  ACCEPTED: "FULFILLING",
  FULFILLING: "DELIVERED",
  DELIVERED: "COMPLETED",
  COMPLETED: null,
};

export type ExternalEventType =
  | "SUPPLIER_CONFIRMATION"
  | "FULFILLMENT_STARTED"
  | "DELIVERY_REPORTED"
  | "SHIPMENT_CREATED"
  | "SHIPMENT_DISPATCHED"
  | "SHIPMENT_IN_TRANSIT"
  | "SUPPLIER_TIMEOUT"
  | "DELIVERY_DELAYED"
  | "PO_CREATED"
  | "PO_SYNCED"
  | "PO_UPDATED";

export interface SimulatedEventOption {
  type: ExternalEventType;
  label: string;
  source: string;
}

/**
 * Simulated integrations, grouped as the external event sources Nobryn
 * receives claims and events from. Real integrations reuse the same
 * ingestion pipeline later.
 */
export const EVENT_SOURCE_GROUPS: {
  source: string;
  events: SimulatedEventOption[];
}[] = [
  {
    source: "Supplier API",
    events: [
      { type: "SUPPLIER_CONFIRMATION", label: "Supplier confirmation", source: "Supplier API" },
      { type: "FULFILLMENT_STARTED", label: "Fulfillment started", source: "Supplier API" },
      { type: "DELIVERY_REPORTED", label: "Delivery reported", source: "Supplier API" },
      { type: "SUPPLIER_TIMEOUT", label: "Supplier timeout", source: "Supplier API" },
    ],
  },
  {
    source: "Warehouse system",
    events: [
      { type: "DELIVERY_REPORTED", label: "Delivery reported (goods received)", source: "Warehouse system" },
    ],
  },
  {
    source: "Logistics provider",
    events: [
      { type: "SHIPMENT_CREATED", label: "Shipment created", source: "Logistics provider" },
      { type: "SHIPMENT_DISPATCHED", label: "Shipment dispatched", source: "Logistics provider" },
      { type: "SHIPMENT_IN_TRANSIT", label: "Shipment in transit", source: "Logistics provider" },
      { type: "DELIVERY_DELAYED", label: "Delivery delayed", source: "Logistics provider" },
      { type: "DELIVERY_REPORTED", label: "Delivery reported", source: "Logistics provider" },
    ],
  },
  {
    source: "ERP",
    events: [
      { type: "PO_CREATED", label: "Purchase order created", source: "ERP" },
      { type: "PO_SYNCED", label: "Purchase order synchronized", source: "ERP" },
      { type: "PO_UPDATED", label: "Purchase order updated", source: "ERP" },
    ],
  },
];

/** Observed reality compared against the original transaction requirements. */
export interface Reconciliation {
  expected: number;
  received: number;
  difference: number;
  result: "MATCH" | "MISMATCH";
  approved: boolean;
  at: string;
}

/** A delivery claim received from an external source, awaiting verification. */
export interface DeliveryClaim {
  id: string;
  source: string;
  reference: string;
  receivedAt: string;
  reportedQuantity: number | null;
  notes: string | null;
}

export const EXCEPTION_LABELS: Record<ExceptionType, string> = {
  SUPPLIER_TIMEOUT: "Supplier timeout",
  DELIVERY_DELAY: "Delivery delay",
  QUANTITY_MISMATCH: "Quantity mismatch",
};

export const EXCEPTION_STATUS_LABELS: Record<ExceptionStatus, string> = {
  OPEN: "OPEN",
  IN_PROGRESS: "IN PROGRESS",
  RESOLVED: "RESOLVED",
};

export interface AuthUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
}

export interface TransactionListItem {
  id: string;
  purchaseOrderNumber: string;
  counterpartyName: string;
  description: string;
  amount: number;
  currency: string;
  state: TransactionState;
  expectedDeliveryDate: string;
  updatedAt: string;
}

export interface EvidenceItem {
  id: string;
  type: string;
  source: string;
  reference: string;
  receivedAt: string;
  verified: boolean;
  notes?: string | null;
}

export interface ExceptionItem {
  id: string;
  type: ExceptionType;
  status: ExceptionStatus;
  description: string;
  detectedAt: string;
  nextAction?: string | null;
  resolutionNote?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
}

export interface ActivityEventItem {
  id: string;
  type: string;
  description: string;
  createdAt: string;
}

export interface TransactionDetail {
  id: string;
  purchaseOrderNumber: string;
  counterpartyId: string;
  counterpartyName: string;
  description: string;
  amount: number;
  currency: string;
  expectedDeliveryDate: string;
  state: TransactionState;
  createdAt: string;
  updatedAt: string;
  items: { id: string; name: string; quantity: number; unitPrice: number; total: number }[];
  evidence: EvidenceItem[];
  exceptions: ExceptionItem[];
  activity: ActivityEventItem[];
  reconciliations: Reconciliation[];
  deliveryClaim: DeliveryClaim | null;
  completionBlocking: string[];
}

export interface Counterparty {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  createdAt: string;
  transactionCount: number;
  lastActivity: string | null;
}

export interface ExceptionListRow {
  id: string;
  transactionId: string;
  purchaseOrderNumber: string;
  type: ExceptionType;
  status: ExceptionStatus;
  description: string;
  detectedAt: string;
  nextAction?: string | null;
  resolutionNote?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
}

export interface Summary {
  cards: {
    activeTransactions: number;
    exceptions: number;
    completed: number;
    counterparties: number;
  };
  recentTransactions: {
    id: string;
    purchaseOrderNumber: string;
    counterpartyName: string;
    amount: number;
    currency: string;
    state: TransactionState;
    updatedAt: string;
  }[];
  openExceptions: {
    id: string;
    transactionId: string;
    purchaseOrderNumber: string;
    type: ExceptionType;
    status: ExceptionStatus;
    detectedAt: string;
    nextAction?: string | null;
  }[];
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
