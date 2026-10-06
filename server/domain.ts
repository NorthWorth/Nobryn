import { z } from "zod";
import { TransactionState, ExceptionType, ExceptionStatus } from "@prisma/client";
import type { AuthedRequest } from "./auth.js";
import type { Request } from "express";

export type TxState = TransactionState;
export { TransactionState, ExceptionType, ExceptionStatus };

export function authed(req: Request): AuthedRequest {
  return req as AuthedRequest;
}

/**
 * Allowed forward transitions of the transaction state machine.
 * CREATED -> ACCEPTED -> FULFILLING -> DELIVERED -> COMPLETED.
 *
 * Transitions are driven by verified business events, never by manual
 * state-changing requests from the user.
 */
export const NEXT_STATE: Record<TxState, TxState | null> = {
  CREATED: TransactionState.ACCEPTED,
  ACCEPTED: TransactionState.FULFILLING,
  FULFILLING: TransactionState.DELIVERED,
  DELIVERED: TransactionState.COMPLETED,
  COMPLETED: null,
};

export const STATE_ORDER: TxState[] = [
  TransactionState.CREATED,
  TransactionState.ACCEPTED,
  TransactionState.FULFILLING,
  TransactionState.DELIVERED,
  TransactionState.COMPLETED,
];

// ---------------------------------------------------------------------------
// Evidence model (claims vs verified evidence)
// ---------------------------------------------------------------------------

/** Evidence types that form the execution chain. */
export const EVIDENCE = {
  supplierConfirmation: "Supplier confirmation",
  fulfillment: "Fulfillment started",
  deliveryClaim: "Delivery reported",
  deliveryConfirmation: "Delivery confirmation",
  completion: "Completion verification",
} as const;

/** Verified evidence required before a transaction may complete. */
export const REQUIRED_VERIFIED_EVIDENCE: string[] = [
  EVIDENCE.supplierConfirmation,
  EVIDENCE.fulfillment,
  EVIDENCE.deliveryConfirmation,
];

// ---------------------------------------------------------------------------
// External event catalog (simulated integrations are event sources)
// ---------------------------------------------------------------------------
//
// Every external/simulated event travels the same path:
//   ingestion -> validation -> verification requirement -> claim/evidence
//   -> human verification when required -> reconciliation -> state update
//
// The simulator is simply the current event source; future real integrations
// reuse this exact catalog and pipeline.

export const EVENT_TYPES = [
  "SUPPLIER_CONFIRMATION",
  "FULFILLMENT_STARTED",
  "DELIVERY_REPORTED",
  "SHIPMENT_CREATED",
  "SHIPMENT_DISPATCHED",
  "SHIPMENT_IN_TRANSIT",
  "SUPPLIER_TIMEOUT",
  "DELIVERY_DELAYED",
  "PO_CREATED",
  "PO_SYNCED",
  "PO_UPDATED",
] as const;

export type ExternalEventType = (typeof EVENT_TYPES)[number];

export interface ExternalEventDef {
  type: ExternalEventType;
  /** Default source name recorded on the claim. */
  source: string;
  /** Sources allowed to report this event. */
  sources: string[];
  label: string;
  summary: string;
  /** Activity description for the recorded claim; `{source}` is replaced. */
  claimDescription: string;
  /** Evidence type recorded for the claim; null for exception-producing events. */
  evidenceType: string | null;
  /**
   * AUTOMATIC: the business rule permits Nobryn to verify the event on receipt.
   * HUMAN: a real-world outcome that must be confirmed by a responsible user
   * before it counts as verified.
   */
  verification: "AUTOMATIC" | "HUMAN";
  referencePrefix: string;
  /** Transaction state in which this event is expected; null = any state. */
  expectedState: TxState | null;
  /** State the transaction moves to after automatic verification; null = informational. */
  stateEffect: TxState | null;
  /** Exception raised by this event instead of recording evidence. */
  exceptionType: ExceptionType | null;
}

export const EVENT_CATALOG: Record<ExternalEventType, ExternalEventDef> = {
  SUPPLIER_CONFIRMATION: {
    type: "SUPPLIER_CONFIRMATION",
    source: "Supplier API",
    sources: ["Supplier API"],
    label: "Supplier confirmation",
    summary: "The supplier confirms it has accepted the purchase order.",
    claimDescription: "Supplier confirmation received from {source}",
    evidenceType: EVIDENCE.supplierConfirmation,
    verification: "AUTOMATIC",
    referencePrefix: "CONF-",
    expectedState: TransactionState.CREATED,
    stateEffect: TransactionState.ACCEPTED,
    exceptionType: null,
  },
  FULFILLMENT_STARTED: {
    type: "FULFILLMENT_STARTED",
    source: "Supplier API",
    sources: ["Supplier API"],
    label: "Fulfillment started",
    summary: "The supplier has started fulfilling the order.",
    claimDescription: "Fulfillment started by {source}",
    evidenceType: EVIDENCE.fulfillment,
    verification: "AUTOMATIC",
    referencePrefix: "FUL-",
    expectedState: TransactionState.ACCEPTED,
    stateEffect: TransactionState.FULFILLING,
    exceptionType: null,
  },
  DELIVERY_REPORTED: {
    type: "DELIVERY_REPORTED",
    source: "Warehouse system",
    sources: ["Warehouse system", "Supplier API", "Logistics provider"],
    label: "Delivery reported",
    summary: "An external system reports that this order was delivered.",
    claimDescription: "Delivery reported by {source}",
    evidenceType: EVIDENCE.deliveryClaim,
    verification: "HUMAN",
    referencePrefix: "DEL-",
    expectedState: TransactionState.FULFILLING,
    stateEffect: null,
    exceptionType: null,
  },
  SHIPMENT_CREATED: {
    type: "SHIPMENT_CREATED",
    source: "Logistics provider",
    sources: ["Logistics provider"],
    label: "Shipment created",
    summary: "A shipment has been created for this order.",
    claimDescription: "Shipment created by {source}",
    evidenceType: "Shipment created",
    verification: "AUTOMATIC",
    referencePrefix: "SHP-",
    expectedState: null,
    stateEffect: null,
    exceptionType: null,
  },
  SHIPMENT_DISPATCHED: {
    type: "SHIPMENT_DISPATCHED",
    source: "Logistics provider",
    sources: ["Logistics provider"],
    label: "Shipment dispatched",
    summary: "The shipment has left the supplier.",
    claimDescription: "Shipment dispatched by {source}",
    evidenceType: "Shipment dispatched",
    verification: "AUTOMATIC",
    referencePrefix: "SHP-",
    expectedState: null,
    stateEffect: null,
    exceptionType: null,
  },
  SHIPMENT_IN_TRANSIT: {
    type: "SHIPMENT_IN_TRANSIT",
    source: "Logistics provider",
    sources: ["Logistics provider"],
    label: "Shipment in transit",
    summary: "The shipment is in transit.",
    claimDescription: "Shipment in transit reported by {source}",
    evidenceType: "Shipment in transit",
    verification: "AUTOMATIC",
    referencePrefix: "SHP-",
    expectedState: null,
    stateEffect: null,
    exceptionType: null,
  },
  SUPPLIER_TIMEOUT: {
    type: "SUPPLIER_TIMEOUT",
    source: "Supplier API",
    sources: ["Supplier API"],
    label: "Supplier timeout",
    summary: "No supplier confirmation was received within the expected window.",
    claimDescription: "Supplier timeout reported by {source}",
    evidenceType: null,
    verification: "AUTOMATIC",
    referencePrefix: "",
    expectedState: null,
    stateEffect: null,
    exceptionType: ExceptionType.SUPPLIER_TIMEOUT,
  },
  DELIVERY_DELAYED: {
    type: "DELIVERY_DELAYED",
    source: "Logistics provider",
    sources: ["Logistics provider"],
    label: "Delivery delayed",
    summary: "Delivery is delayed beyond the expected delivery date.",
    claimDescription: "Delivery delay reported by {source}",
    evidenceType: null,
    verification: "AUTOMATIC",
    referencePrefix: "",
    expectedState: null,
    stateEffect: null,
    exceptionType: ExceptionType.DELIVERY_DELAY,
  },
  PO_CREATED: {
    type: "PO_CREATED",
    source: "ERP",
    sources: ["ERP"],
    label: "Purchase order created",
    summary: "The purchase order was created in the ERP.",
    claimDescription: "Purchase order created in {source}",
    evidenceType: "Purchase order created",
    verification: "AUTOMATIC",
    referencePrefix: "ERP-",
    expectedState: null,
    stateEffect: null,
    exceptionType: null,
  },
  PO_SYNCED: {
    type: "PO_SYNCED",
    source: "ERP",
    sources: ["ERP"],
    label: "Purchase order synchronized",
    summary: "The purchase order was synchronized with the ERP.",
    claimDescription: "Purchase order synchronized with {source}",
    evidenceType: "Purchase order synchronized",
    verification: "AUTOMATIC",
    referencePrefix: "ERP-",
    expectedState: null,
    stateEffect: null,
    exceptionType: null,
  },
  PO_UPDATED: {
    type: "PO_UPDATED",
    source: "ERP",
    sources: ["ERP"],
    label: "Purchase order updated",
    summary: "The purchase order was updated in the ERP.",
    claimDescription: "Purchase order updated in {source}",
    evidenceType: "Purchase order updated",
    verification: "AUTOMATIC",
    referencePrefix: "ERP-",
    expectedState: null,
    stateEffect: null,
    exceptionType: null,
  },
};

/** Exception display metadata shared by API responses. */
export const EXCEPTION_META: Record<
  ExceptionType,
  { label: string; description: string; nextAction: string }
> = {
  [ExceptionType.SUPPLIER_TIMEOUT]: {
    label: "Supplier timeout",
    description:
      "The supplier has not confirmed the purchase order within the expected time.",
    nextAction: "Supplier confirmation required",
  },
  [ExceptionType.DELIVERY_DELAY]: {
    label: "Delivery delay",
    description: "The expected delivery date has passed without a verified delivery event.",
    nextAction: "Retry delivery verification",
  },
  [ExceptionType.QUANTITY_MISMATCH]: {
    label: "Quantity mismatch",
    description: "The received quantity does not match the ordered quantity.",
    nextAction: "Supplier confirmation required",
  },
};

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

export const registerSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required."),
  lastName: z.string().trim().min(1, "Last name is required."),
  email: z.string().trim().email("A valid email address is required."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  workspaceName: z.string().trim().min(1, "Workspace name is required."),
});

export const loginSchema = z.object({
  email: z.string().trim().email("A valid email address is required."),
  password: z.string().trim().min(1, "Password is required."),
});

export const counterpartySchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required."),
  contactName: z.string().trim().min(1, "Contact name is required."),
  email: z.string().trim().email("A valid contact email is required."),
});

export const createTransactionSchema = z
  .object({
    purchaseOrderNumber: z
      .string()
      .trim()
      .min(1, "Purchase order number is required."),
    counterpartyId: z.string().trim().min(1, "Counterparty is required."),
    description: z.string().trim().min(1, "Description is required."),
    amount: z
      .number({ message: "Transaction amount is required." })
      .positive("Amount must be greater than zero."),
    currency: z.string().trim().min(1, "Currency is required.").default("USD"),
    expectedDeliveryDate: z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), "A valid delivery date is required."),
    items: z
      .array(
        z.object({
          name: z.string().trim().min(1, "Item name is required."),
          quantity: z
            .number({ message: "Quantity is required." })
            .positive("Quantity must be greater than zero."),
          unitPrice: z
            .number({ message: "Unit price is required." })
            .nonnegative("Unit price cannot be negative."),
        })
      )
      .min(1, "At least one item is required."),
  })
  .superRefine((val, ctx) => {
    const itemTotal = val.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0
    );
    if (Math.abs(itemTotal - val.amount) > 0.01) {
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: "Amount must equal the total of all items.",
      });
    }
  });

export const resolveExceptionSchema = z.object({
  resolutionNote: z
    .string()
    .trim()
    .min(1, "Resolution note is required.")
    .max(2000, "Resolution note is too long."),
});

/** Ingest an external/simulated event into the execution pipeline. */
export const ingestEventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  source: z.string().trim().min(1).optional(),
  reportedQuantity: z
    .number({ message: "Reported quantity is required." })
    .positive("Reported quantity must be greater than zero.")
    .optional(),
});

/**
 * A human confirming the real-world delivery fact: what was actually
 * received, and when. This is a business confirmation, not a state change.
 */
export const verifyDeliverySchema = z.object({
  receivedQuantity: z
    .number({ message: "Received quantity is required." })
    .positive("Received quantity must be greater than zero."),
  deliveryDate: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "A valid delivery date is required."),
  note: z.string().trim().max(2000, "Note is too long.").optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Workspace name is required."),
});

export const updateAccountSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required."),
  lastName: z.string().trim().min(1, "Last name is required."),
});
