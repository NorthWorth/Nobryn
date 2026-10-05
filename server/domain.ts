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
 * CREATED -> ACCEPTED -> FULFILLING -> DELIVERED -> COMPLETED
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

export interface ExecutionStepDef {
  key: string;
  label: string;
  /** Evidence type recorded when this step completes. */
  evidenceType: string;
  source: string;
  referencePrefix: string;
  activityType: string;
  activityDescription: string;
}

/**
 * The deterministic simulated execution engine's step definitions.
 * Each step produces an evidence record and activity events.
 */
export const EXECUTION_STEPS: Record<TxState, ExecutionStepDef | null> = {
  [TransactionState.CREATED]: {
    key: "supplier_confirmation",
    label: "Supplier confirmation",
    evidenceType: "Supplier confirmation",
    source: "Supplier API",
    referencePrefix: "Confirmation #",
    activityType: "SUPPLIER_CONFIRMED",
    activityDescription: "Supplier confirmation received",
  },
  [TransactionState.ACCEPTED]: {
    key: "fulfillment",
    label: "Fulfillment",
    evidenceType: "Fulfillment started",
    source: "Supplier API",
    referencePrefix: "Fulfillment order #",
    activityType: "FULFILLMENT_STARTED",
    activityDescription: "Fulfillment started",
  },
  [TransactionState.FULFILLING]: {
    key: "delivery_confirmation",
    label: "Delivery confirmation",
    evidenceType: "Delivery confirmation",
    source: "Warehouse system",
    referencePrefix: "GRN-",
    activityType: "DELIVERY_CONFIRMED",
    activityDescription: "Delivery confirmed",
  },
  [TransactionState.DELIVERED]: {
    key: "completion_verification",
    label: "Completion verification",
    evidenceType: "Completion verification",
    source: "Nobryn",
    referencePrefix: "VR-",
    activityType: "COMPLETION_VERIFIED",
    activityDescription: "Completion verified",
  },
  [TransactionState.COMPLETED]: null,
};

/** The transition into COMPLETED requires verified delivery evidence. */
export const REQUIRED_EVIDENCE_FOR_COMPLETION = "Delivery confirmation";

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
    description:
      "The expected delivery date has passed without a verified delivery event.",
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
  password: z.string().min(1, "Password is required."),
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

export const advanceStateSchema = z.object({
  state: z.enum([
    TransactionState.ACCEPTED,
    TransactionState.FULFILLING,
    TransactionState.DELIVERED,
    TransactionState.COMPLETED,
  ]),
});

export const resolveExceptionSchema = z.object({
  resolutionNote: z
    .string()
    .trim()
    .min(1, "Resolution note is required.")
    .max(2000, "Resolution note is too long."),
});

export const simulateExceptionSchema = z.object({
  type: z.enum([
    ExceptionType.SUPPLIER_TIMEOUT,
    ExceptionType.DELIVERY_DELAY,
    ExceptionType.QUANTITY_MISMATCH,
  ]),
});

export const evidenceSchema = z.object({
  type: z.string().trim().min(1, "Evidence type is required."),
  source: z.string().trim().min(1, "Source is required."),
  reference: z.string().trim().min(1, "Reference is required."),
  notes: z.string().trim().optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Workspace name is required."),
});

export const updateAccountSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required."),
  lastName: z.string().trim().min(1, "Last name is required."),
});

export const QUANTITY_MISMATCH_DELTA = {
  expected: 500,
  received: 470,
};
