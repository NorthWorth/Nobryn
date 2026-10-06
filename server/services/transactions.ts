import { prisma } from "../prisma.js";
import type {
  ActivityEvent,
  Counterparty,
  Evidence,
  Exception,
  Transaction,
  TransactionItem,
} from "@prisma/client";
import { TransactionState, ExceptionType, ExceptionStatus, Prisma } from "@prisma/client";
import { ApiError } from "../errors.js";
import {
  EVENT_CATALOG,
  EXCEPTION_META,
  EVIDENCE,
  REQUIRED_VERIFIED_EVIDENCE,
  NEXT_STATE,
  STATE_ORDER,
  type ExternalEventType,
} from "../domain.js";

export type TransactionWithRelations = Transaction & {
  counterparty: Counterparty;
  items: TransactionItem[];
  evidence: Evidence[];
  exceptions: Exception[];
  activity: ActivityEvent[];
};

/**
 * A reconciliation record as persisted in activity metadata:
 * expected reality vs observed reality, and the result of comparing them.
 */
export interface ReconciliationRecord {
  expected: number;
  received: number;
  difference: number;
  result: "MATCH" | "MISMATCH";
  approved: boolean;
  at: string;
}

/** A delivery claim that has been received but not yet confirmed by a human. */
export interface DeliveryClaimInfo {
  id: string;
  source: string;
  reference: string;
  receivedAt: string;
  reportedQuantity: number | null;
  notes: string | null;
}

/** How long a purchase order may sit in CREATED without supplier confirmation. */
const SUPPLIER_TIMEOUT_WINDOW_MS = 48 * 60 * 60 * 1000;

const txInclude = {
  counterparty: true,
  items: true,
  evidence: true,
  exceptions: true,
  activity: true,
} as const;

// ---------------------------------------------------------------------------
// Predicates shared by the execution engine
// ---------------------------------------------------------------------------

function hasVerified(t: TransactionWithRelations, evidenceType: string): boolean {
  return t.evidence.some((e) => e.verified && e.type === evidenceType);
}

function openExceptions(t: TransactionWithRelations): Exception[] {
  return t.exceptions.filter((x) => x.status !== ExceptionStatus.RESOLVED);
}

function expectedQuantity(t: TransactionWithRelations): number {
  const total = t.items.reduce((sum, item) => sum + Number(item.quantity), 0);
  return Math.round(total * 100) / 100;
}

function parseReconciliation(a: ActivityEvent): ReconciliationRecord | null {
  if (a.type !== "RECONCILED") return null;
  const m = (a.metadata ?? null) as Record<string, unknown> | null;
  if (
    !m ||
    typeof m.expected !== "number" ||
    typeof m.received !== "number" ||
    (m.result !== "MATCH" && m.result !== "MISMATCH")
  ) {
    return null;
  }
  return {
    expected: m.expected,
    received: m.received,
    difference: typeof m.difference === "number" ? m.difference : 0,
    result: m.result,
    approved: m.approved === true,
    at: a.createdAt.toISOString(),
  };
}

function reconciliationsOf(t: TransactionWithRelations): ReconciliationRecord[] {
  return t.activity
    .map(parseReconciliation)
    .filter((r): r is ReconciliationRecord => r !== null)
    .sort((a, b) => a.at.localeCompare(b.at));
}

function deliveryClaimOf(t: TransactionWithRelations): DeliveryClaimInfo | null {
  const claim = t.evidence.find(
    (e) => e.type === EVIDENCE.deliveryClaim && !e.verified
  );
  if (!claim) return null;
  const act = t.activity.find((a) => {
    const m = (a.metadata ?? null) as Record<string, unknown> | null;
    return a.type === "CLAIM_RECEIVED" && m?.reference === claim.reference;
  });
  const m = (act?.metadata ?? null) as Record<string, unknown> | null;
  return {
    id: claim.id,
    source: claim.source,
    reference: claim.reference,
    receivedAt: claim.receivedAt.toISOString(),
    reportedQuantity:
      m && typeof m.reportedQuantity === "number" ? m.reportedQuantity : null,
    notes: claim.notes,
  };
}

/**
 * Why the transaction cannot proceed to/through completion right now.
 * Open exceptions and unresolved mismatches block at any stage; missing
 * evidence only becomes a blocking reason once delivery is DELIVERED.
 */
function completionBlockers(t: TransactionWithRelations): string[] {
  const reasons: string[] = [];

  const open = openExceptions(t);
  if (open.length > 0) {
    reasons.push(
      `Blocking exception${open.length > 1 ? "s" : ""}: ${open
        .map((x) => EXCEPTION_META[x.type].label)
        .join(", ")}.`
    );
  }

  const latest = reconciliationsOf(t).at(-1);
  const mismatchOpen = !!latest && latest.result !== "MATCH";
  const mismatchExceptionOpen = t.exceptions.some(
    (x) => x.type === ExceptionType.QUANTITY_MISMATCH && x.status !== ExceptionStatus.RESOLVED
  );
  if (mismatchOpen && !mismatchExceptionOpen) {
    reasons.push("Reconciliation shows a quantity mismatch that has not been resolved.");
  }

  if (t.state === TransactionState.DELIVERED) {
    for (const evidenceType of REQUIRED_VERIFIED_EVIDENCE) {
      if (!hasVerified(t, evidenceType)) {
        reasons.push(`${evidenceType} has not been verified.`);
      }
    }
    if (!latest) {
      reasons.push("Delivery has not been reconciled against the ordered quantity.");
    }
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function serializeTransaction(t: TransactionWithRelations) {
  return {
    id: t.id,
    purchaseOrderNumber: t.purchaseOrderNumber,
    counterpartyId: t.counterpartyId,
    counterpartyName: t.counterparty.companyName,
    description: t.description,
    amount: Number(t.amount),
    currency: t.currency,
    expectedDeliveryDate: t.expectedDeliveryDate.toISOString(),
    state: t.state,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    items: t.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      total: Number(item.total),
    })),
    evidence: t.evidence
      .map((e) => ({
        id: e.id,
        type: e.type,
        source: e.source,
        reference: e.reference,
        receivedAt: e.receivedAt.toISOString(),
        verified: e.verified,
        notes: e.notes,
      }))
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)),
    exceptions: t.exceptions
      .map((x) => ({
        id: x.id,
        type: x.type,
        status: x.status,
        description: x.description,
        detectedAt: x.detectedAt.toISOString(),
        nextAction: x.nextAction,
        resolutionNote: x.resolutionNote,
        resolvedAt: x.resolvedAt?.toISOString(),
        resolvedBy: x.resolvedBy,
      }))
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)),
    activity: t.activity
      .map((a) => ({
        id: a.id,
        type: a.type,
        description: a.description,
        createdAt: a.createdAt.toISOString(),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    reconciliations: reconciliationsOf(t),
    deliveryClaim: deliveryClaimOf(t),
    completionBlocking: completionBlockers(t),
  };
}

export type SerializedTransaction = ReturnType<typeof serializeTransaction>;

export async function getTransactionScoped(workspaceId: string, id: string) {
  const tx = await prisma.transaction.findFirst({
    where: { id, workspaceId },
    include: txInclude,
  });
  if (!tx) {
    throw new ApiError(404, "Unable to load transaction. It may not exist in this workspace.");
  }
  return tx;
}

async function addActivity(
  transactionId: string,
  type: string,
  description: string,
  metadata?: Record<string, unknown>
) {
  return prisma.activityEvent.create({
    data: {
      transactionId,
      type,
      description,
      metadata: (metadata ?? undefined) as never,
    },
  });
}

function makeReference(prefix: string): string {
  return `${prefix}${Math.floor(100000 + Math.random() * 899999)}`;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export async function createTransaction(
  workspaceId: string,
  input: {
    purchaseOrderNumber: string;
    counterpartyId: string;
    description: string;
    amount: number;
    currency: string;
    expectedDeliveryDate: string;
    items: { name: string; quantity: number; unitPrice: number }[];
  }
) {
  const counterparty = await prisma.counterparty.findFirst({
    where: { id: input.counterpartyId, workspaceId },
  });
  if (!counterparty) {
    throw new ApiError(400, "Counterparty not found in this workspace.");
  }

  const duplicate = await prisma.transaction.findFirst({
    where: { workspaceId, purchaseOrderNumber: input.purchaseOrderNumber },
  });
  if (duplicate) {
    throw new ApiError(
      400,
      "A transaction with this purchase order number already exists.",
      { purchaseOrderNumber: "This purchase order number is already in use." }
    );
  }

  const parsedDelivery = new Date(input.expectedDeliveryDate);
  if (Number.isNaN(parsedDelivery.getTime())) {
    throw new ApiError(400, "Please provide a valid expected delivery date.", {
      expectedDeliveryDate: "A valid delivery date is required.",
    });
  }

  const items = input.items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    total: Math.round(item.quantity * item.unitPrice * 100) / 100,
  }));
  const amount = Math.round(input.amount * 100) / 100;

  const tx = await prisma.transaction.create({
    data: {
      workspaceId,
      purchaseOrderNumber: input.purchaseOrderNumber,
      counterpartyId: counterparty.id,
      description: input.description,
      amount,
      currency: input.currency,
      expectedDeliveryDate: parsedDelivery,
      state: TransactionState.CREATED,
      items: { create: items },
    },
    include: txInclude,
  });

  await addActivity(tx.id, "TRANSACTION_CREATED", "Transaction created", {
    purchaseOrderNumber: tx.purchaseOrderNumber,
  });

  return getTransactionScoped(workspaceId, tx.id);
}

// ---------------------------------------------------------------------------
// Execution engine: state changes, exceptions, completion
// ---------------------------------------------------------------------------

async function applyStateChange(
  db: Prisma.TransactionClient,
  transactionId: string,
  target: TransactionState
) {
  await db.transaction.update({
    where: { id: transactionId },
    data: { state: target },
  });
  await db.activityEvent.create({
    data: {
      transactionId,
      type: "STATE_CHANGED",
      description: `Transaction moved to ${stateLabel(target)}`,
    },
  });
}

async function createExceptionRecord(
  db: Prisma.TransactionClient,
  transactionId: string,
  type: ExceptionType,
  descriptionOverride?: string,
  nextActionOverride?: string,
  metadata?: Record<string, unknown>
) {
  const meta = EXCEPTION_META[type];
  const exception = await db.exception.create({
    data: {
      transactionId,
      type,
      status: ExceptionStatus.OPEN,
      description: descriptionOverride ?? meta.description,
      nextAction: nextActionOverride ?? meta.nextAction,
    },
  });
  await db.activityEvent.create({
    data: {
      transactionId,
      type: "EXCEPTION_DETECTED",
      description: `Exception detected: ${meta.label}`,
      metadata: (metadata ?? undefined) as never,
    },
  });
  return exception;
}

/**
 * Timer-based detection run by the engine itself (no external event needed):
 *  - SUPPLIER_TIMEOUT when no confirmation arrived within the expected window.
 *  - DELIVERY_DELAY when the expected delivery date passed without delivery.
 */
export async function evaluateAutomaticExceptions(workspaceId: string, id: string) {
  const tx = await getTransactionScoped(workspaceId, id);
  const now = Date.now();

  const hasExceptionOf = (type: ExceptionType) =>
    tx.exceptions.some((x) => x.type === type);

  const candidates: { type: ExceptionType; metadata: Record<string, unknown> }[] = [];

  if (
    tx.state === TransactionState.CREATED &&
    !hasVerified(tx, EVIDENCE.supplierConfirmation) &&
    now - tx.createdAt.getTime() > SUPPLIER_TIMEOUT_WINDOW_MS &&
    !hasExceptionOf(ExceptionType.SUPPLIER_TIMEOUT)
  ) {
    candidates.push({
      type: ExceptionType.SUPPLIER_TIMEOUT,
      metadata: {
        source: "Nobryn",
        expected: "Supplier confirmation",
        actual: "No confirmation within the expected window",
      },
    });
  }

  if (
    tx.state !== TransactionState.DELIVERED &&
    tx.state !== TransactionState.COMPLETED &&
    !hasVerified(tx, EVIDENCE.deliveryConfirmation) &&
    tx.expectedDeliveryDate.getTime() < now &&
    !hasExceptionOf(ExceptionType.DELIVERY_DELAY)
  ) {
    candidates.push({
      type: ExceptionType.DELIVERY_DELAY,
      metadata: {
        source: "Nobryn",
        expected: "Delivery claim by the expected delivery date",
        actual: "No delivery claim received",
      },
    });
  }

  if (candidates.length === 0) return false;

  await prisma.$transaction(async (db) => {
    for (const candidate of candidates) {
      await createExceptionRecord(
        db,
        tx.id,
        candidate.type,
        undefined,
        undefined,
        candidate.metadata
      );
    }
  });
  return true;
}

/** Read path: run engine-side detection, then return the fresh transaction. */
export async function getTransactionForDisplay(workspaceId: string, id: string) {
  await evaluateAutomaticExceptions(workspaceId, id);
  return getTransactionScoped(workspaceId, id);
}

function unexpectedStateMessage(
  def: (typeof EVENT_CATALOG)[ExternalEventType],
  state: TransactionState
): string {
  switch (def.type) {
    case "SUPPLIER_CONFIRMATION":
      return "The purchase order has already been accepted.";
    case "FULFILLMENT_STARTED":
      return "Fulfillment cannot start before the supplier confirms the order.";
    case "DELIVERY_REPORTED":
      if (state === TransactionState.CREATED || state === TransactionState.ACCEPTED) {
        return "Delivery cannot be reported before fulfillment has started.";
      }
      break;
    default:
      break;
  }
  return `${def.label} is not expected while the transaction is in state ${stateLabel(state)}.`;
}

// ---------------------------------------------------------------------------
// Event ingestion (simulated integrations are simply the current event source)
// ---------------------------------------------------------------------------

export interface IngestResult {
  transaction: TransactionWithRelations;
  duplicate: boolean;
  awaitingVerification: boolean;
}

export async function ingestExternalEvent(
  workspaceId: string,
  id: string,
  input: { type: ExternalEventType; source?: string; reportedQuantity?: number }
): Promise<IngestResult> {
  const tx = await getTransactionScoped(workspaceId, id);
  const def = EVENT_CATALOG[input.type];
  const source =
    input.source && def.sources.includes(input.source) ? input.source : def.source;

  // 1. Duplicate events are acknowledged but never recorded twice.
  if (def.evidenceType && tx.evidence.some((e) => e.type === def.evidenceType)) {
    return { transaction: tx, duplicate: true, awaitingVerification: false };
  }
  if (
    def.exceptionType &&
    tx.exceptions.some((x) => x.type === def.exceptionType)
  ) {
    return { transaction: tx, duplicate: true, awaitingVerification: false };
  }

  // 2. Validate the claim against the execution rules.
  if (def.exceptionType === ExceptionType.SUPPLIER_TIMEOUT) {
    if (hasVerified(tx, EVIDENCE.supplierConfirmation)) {
      throw new ApiError(
        409,
        "The supplier has already confirmed this order — there is no timeout."
      );
    }
  } else if (def.exceptionType === ExceptionType.DELIVERY_DELAY) {
    if (hasVerified(tx, EVIDENCE.deliveryConfirmation)) {
      throw new ApiError(409, "Delivery has already been verified for this transaction.");
    }
  } else if (def.expectedState && tx.state !== def.expectedState) {
    throw new ApiError(409, unexpectedStateMessage(def, tx.state));
  }

  const eventRef = def.evidenceType ? makeReference(def.referencePrefix) : "";

  await prisma.$transaction(async (db) => {
    // 3. Record the claim exactly as the external source reported it.
    await db.activityEvent.create({
      data: {
        transactionId: tx.id,
        type: "CLAIM_RECEIVED",
        description: def.claimDescription.replace("{source}", source),
        metadata: {
          source,
          type: def.type,
          ...(eventRef ? { reference: eventRef } : {}),
          ...(input.reportedQuantity != null
            ? { reportedQuantity: input.reportedQuantity }
            : {}),
        } as never,
      },
    });

    // 4. Exception-producing events become system-generated exceptions.
    if (def.exceptionType) {
      await createExceptionRecord(
        db,
        tx.id,
        def.exceptionType,
        undefined,
        undefined,
        {
          source,
          expected:
            def.exceptionType === ExceptionType.SUPPLIER_TIMEOUT
              ? "Supplier confirmation"
              : "Delivery claim by the expected delivery date",
          actual: def.summary,
        }
      );
      return;
    }

    // 5. Record the claim as evidence. CLAIM != VERIFICATION: only events
    //    whose business rule permits it are verified on receipt.
    const automatic = def.verification === "AUTOMATIC";
    const notes = automatic
      ? `Received from ${source}. Verified automatically under the execution rules.`
      : input.reportedQuantity != null
        ? `Reported quantity: ${input.reportedQuantity} units. Awaiting human verification.`
        : `Reported by ${source}. Awaiting human verification.`;

    await db.evidence.create({
      data: {
        transactionId: tx.id,
        type: def.evidenceType as string,
        source,
        reference: eventRef,
        verified: automatic,
        notes,
      },
    });

    if (automatic) {
      await db.activityEvent.create({
        data: {
          transactionId: tx.id,
          type: "EVENT_VERIFIED",
          description: `${def.label} verified automatically (${source})`,
        },
      });
      // 6. Advance the state machine only where the execution rules allow it.
      if (
        def.stateEffect &&
        def.expectedState &&
        tx.state === def.expectedState &&
        NEXT_STATE[tx.state] === def.stateEffect
      ) {
        await applyStateChange(db, tx.id, def.stateEffect);
      }
    }
  });

  await evaluateAutomaticExceptions(workspaceId, id);
  const updated = await getTransactionScoped(workspaceId, id);
  return {
    transaction: updated,
    duplicate: false,
    awaitingVerification: def.verification === "HUMAN",
  };
}

// ---------------------------------------------------------------------------
// Human verification of a delivery claim + reconciliation
// ---------------------------------------------------------------------------

export async function verifyDelivery(
  workspaceId: string,
  id: string,
  input: { receivedQuantity: number; deliveryDate: string; note?: string },
  verifiedBy: string
): Promise<TransactionWithRelations> {
  const tx = await getTransactionScoped(workspaceId, id);

  if (tx.state !== TransactionState.FULFILLING) {
    throw new ApiError(
      409,
      `A delivery claim can only be confirmed while the transaction is fulfilling. ` +
        `This transaction is in state ${stateLabel(tx.state)}.`
    );
  }
  const claim = tx.evidence.find(
    (e) => e.type === EVIDENCE.deliveryClaim && !e.verified
  );
  if (!claim) {
    throw new ApiError(
      409,
      "There is no delivery claim awaiting verification for this transaction."
    );
  }
  if (hasVerified(tx, EVIDENCE.deliveryConfirmation)) {
    throw new ApiError(409, "Delivery has already been verified for this transaction.");
  }

  const expected = expectedQuantity(tx);
  const received = Math.round(input.receivedQuantity * 100) / 100;
  const difference = Math.round((received - expected) * 100) / 100;
  const result: "MATCH" | "MISMATCH" = Math.abs(difference) < 0.005 ? "MATCH" : "MISMATCH";
  const deliveryDate = new Date(input.deliveryDate);

  return prisma.$transaction(async (db) => {
    // Verified evidence: the human-confirmed real-world outcome.
    await db.evidence.create({
      data: {
        transactionId: tx.id,
        type: EVIDENCE.deliveryConfirmation,
        source: claim.source,
        reference: makeReference("GRN-"),
        verified: true,
        notes: [
          `Delivery date: ${deliveryDate.toISOString().slice(0, 10)}.`,
          `Confirmed by ${verifiedBy}.`,
          input.note ? `Note: ${input.note}` : null,
        ]
          .filter(Boolean)
          .join(" "),
      },
    });
    await db.activityEvent.create({
      data: {
        transactionId: tx.id,
        type: "CLAIM_VERIFIED",
        description: `Delivery confirmed by ${verifiedBy}`,
        metadata: {
          claimReference: claim.reference,
          deliveryDate: deliveryDate.toISOString(),
          receivedQuantity: received,
        } as never,
      },
    });

    // Reconcile observed reality against the original transaction requirements.
    await db.activityEvent.create({
      data: {
        transactionId: tx.id,
        type: "RECONCILED",
        description:
          result === "MATCH"
            ? `Delivery reconciled: ${expected} ordered / ${received} received — MATCH`
            : `Delivery reconciled: ${expected} ordered / ${received} received — MISMATCH (difference ${difference})`,
        metadata: {
          expected,
          received,
          difference,
          result,
          source: claim.source,
        } as never,
      },
    });

    if (result === "MATCH") {
      // Verified + reconciled: the transaction may advance, then completion
      // is evaluated against every required condition.
      await applyStateChange(db, tx.id, TransactionState.DELIVERED);
      await runCompletionEvaluation(db, tx.id);
    } else {
      await createExceptionRecord(
        db,
        tx.id,
        ExceptionType.QUANTITY_MISMATCH,
        `Expected ${expected} units, received ${received} units (difference ${difference} units).`,
        EXCEPTION_META[ExceptionType.QUANTITY_MISMATCH].nextAction,
        { source: "Reconciliation", expected, received, difference }
      );
    }

    return db.transaction.findUniqueOrThrow({
      where: { id: tx.id },
      include: txInclude,
    });
  });
}

/**
 * Completion requires every required condition to hold — it can never be
 * triggered by a generic "complete" action.
 */
async function runCompletionEvaluation(
  db: Prisma.TransactionClient,
  transactionId: string
): Promise<boolean> {
  const tx = await db.transaction.findUnique({
    where: { id: transactionId },
    include: txInclude,
  });
  if (!tx || tx.state !== TransactionState.DELIVERED) return false;
  if (hasVerified(tx, EVIDENCE.completion)) return false;
  if (completionBlockers(tx).length > 0) return false;

  await db.evidence.create({
    data: {
      transactionId,
      type: EVIDENCE.completion,
      source: "Nobryn",
      reference: makeReference("VR-"),
      verified: true,
      notes:
        "Completion verification passed: required evidence verified, delivery reconciled, no blocking exceptions.",
    },
  });
  await db.activityEvent.create({
    data: {
      transactionId,
      type: "COMPLETION_VERIFIED",
      description: "Completion verified",
    },
  });
  await applyStateChange(db, transactionId, TransactionState.COMPLETED);
  return true;
}

/**
 * Re-evaluate the underlying transaction condition after a human resolves an
 * exception. Resolution never moves a transaction forward by itself — it only
 * re-runs the checks that decide whether execution may continue.
 */
async function reevaluateTransaction(db: Prisma.TransactionClient, transactionId: string) {
  const tx = await db.transaction.findUnique({
    where: { id: transactionId },
    include: txInclude,
  });
  if (!tx) return;

  await db.activityEvent.create({
    data: {
      transactionId,
      type: "REEVALUATED",
      description: "Transaction re-evaluated after exception resolution",
    },
  });

  if (tx.state === TransactionState.FULFILLING) {
    if (!hasVerified(tx, EVIDENCE.deliveryConfirmation)) return;
    if (openExceptions(tx).length > 0) return;

    const latest = reconciliationsOf(tx).at(-1);
    if (!latest) return;

    if (latest.result === "MISMATCH") {
      // The mismatch was resolved/approved by a human: record the approved
      // reconciliation so the evidence chain shows why execution continues.
      await db.activityEvent.create({
        data: {
          transactionId,
          type: "RECONCILED",
          description: `Delivery reconciled with approved variance: ${latest.expected} ordered / ${latest.received} received — MATCH`,
          metadata: {
            expected: latest.expected,
            received: latest.received,
            difference: latest.difference,
            result: "MATCH",
            approved: true,
          } as never,
        },
      });
    }

    await applyStateChange(db, transactionId, TransactionState.DELIVERED);
    await runCompletionEvaluation(db, transactionId);
    return;
  }

  if (tx.state === TransactionState.DELIVERED) {
    await runCompletionEvaluation(db, transactionId);
  }
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export async function resolveException(
  workspaceId: string,
  exceptionId: string,
  resolutionNote: string,
  resolvedBy: string
) {
  const exception = await prisma.exception.findFirst({
    where: { id: exceptionId, transaction: { workspaceId } },
  });
  if (!exception) {
    throw new ApiError(404, "Unable to find this exception. It may already have been resolved.");
  }
  if (exception.status === ExceptionStatus.RESOLVED) {
    throw new ApiError(409, "This exception has already been resolved.");
  }
  return prisma.$transaction(async (db) => {
    const updated = await db.exception.update({
      where: { id: exception.id },
      data: {
        status: ExceptionStatus.RESOLVED,
        resolutionNote,
        resolvedAt: new Date(),
        resolvedBy,
      },
    });
    await db.activityEvent.create({
      data: {
        transactionId: exception.transactionId,
        type: "EXCEPTION_RESOLVED",
        description: `Exception resolved: ${EXCEPTION_META[exception.type].label}`,
        metadata: { resolutionNote, resolvedBy } as never,
      },
    });
    // Resolution triggers re-evaluation of the underlying condition.
    await reevaluateTransaction(db, exception.transactionId);
    return updated;
  });
}

export async function listExceptions(workspaceId: string, status?: ExceptionStatus) {
  const rows = await prisma.exception.findMany({
    where: { transaction: { workspaceId }, ...(status ? { status } : {}) },
    include: {
      transaction: {
        select: { purchaseOrderNumber: true, id: true },
      },
    },
    orderBy: { detectedAt: "desc" },
  });
  return rows.map((x) => ({
    id: x.id,
    transactionId: x.transaction.id,
    purchaseOrderNumber: x.transaction.purchaseOrderNumber,
    type: x.type,
    status: x.status,
    description: x.description,
    detectedAt: x.detectedAt.toISOString(),
    nextAction: x.nextAction,
    resolutionNote: x.resolutionNote,
    resolvedAt: x.resolvedAt?.toISOString(),
    resolvedBy: x.resolvedBy,
  }));
}

// ---------------------------------------------------------------------------
// Listing / summary helpers
// ---------------------------------------------------------------------------

export function stateLabel(state: TransactionState): string {
  switch (state) {
    case TransactionState.CREATED:
      return "Created";
    case TransactionState.ACCEPTED:
      return "Accepted";
    case TransactionState.FULFILLING:
      return "Fulfilling";
    case TransactionState.DELIVERED:
      return "Delivered";
    case TransactionState.COMPLETED:
      return "Completed";
  }
}

export { STATE_ORDER };

export function listTransactionsOptions(
  workspaceId: string,
  opts: { search?: string; state?: TransactionState }
) {
  const where: Record<string, unknown> = { workspaceId };
  if (opts.state) where.state = opts.state;
  if (opts.search) {
    where.OR = [
      { purchaseOrderNumber: { contains: opts.search, mode: "insensitive" } },
      { description: { contains: opts.search, mode: "insensitive" } },
      { counterparty: { companyName: { contains: opts.search, mode: "insensitive" } } },
    ];
  }
  return where;
}

export { addActivity };
