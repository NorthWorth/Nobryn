import { prisma } from "../prisma.js";
import type {
  ActivityEvent,
  Counterparty,
  Evidence,
  Exception,
  Transaction,
  TransactionItem,
  TransactionPolicy,
} from "@prisma/client";
import {
  TransactionState,
  ExceptionType,
  ExceptionStatus,
  ExceptionSeverity,
  Prisma,
} from "@prisma/client";
import { ApiError } from "../errors.js";
import {
  EVENT_CATALOG,
  EVENT_RESULT,
  EVENT_STATUS,
  EXCEPTION_META,
  EVIDENCE,
  NOTIFICATION_TYPE,
  REQUIRED_VERIFIED_EVIDENCE,
  NEXT_STATE,
  STATE_ORDER,
  activityCategory,
  completionConditionText,
  type ExternalEventType,
  type NotificationType,
  type PolicyValues,
} from "../domain.js";
import { notify } from "./notifications.js";
import { resolvePolicy, resolvePolicySelection } from "./policies.js";
import type { IntegrationAdapter } from "../integrations/types.js";

export type TransactionWithRelations = Transaction & {
  counterparty: Counterparty;
  items: TransactionItem[];
  evidence: Evidence[];
  exceptions: Exception[];
  activity: ActivityEvent[];
  policy: TransactionPolicy | null;
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
  tolerance?: number;
  withinTolerance?: boolean;
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

const txInclude = {
  counterparty: true,
  items: true,
  evidence: true,
  exceptions: true,
  activity: true,
  policy: true,
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

/** Only blocking exceptions hold execution/completion back. */
function blockingExceptions(t: TransactionWithRelations): Exception[] {
  return openExceptions(t).filter((x) => x.blocking);
}

function policyOf(t: TransactionWithRelations): PolicyValues {
  return resolvePolicy(t.policy);
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
    ...(typeof m.tolerance === "number" ? { tolerance: m.tolerance } : {}),
    ...(typeof m.withinTolerance === "boolean"
      ? { withinTolerance: m.withinTolerance }
      : {}),
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
  // Once delivery is verified, the claim is no longer awaiting anything.
  if (hasVerified(t, EVIDENCE.deliveryConfirmation)) return null;
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
 * Why execution cannot proceed toward completion right now. Open blocking
 * exceptions and unresolved blocking mismatches block at any stage; missing
 * evidence only becomes a blocking reason once DELIVERED. All gates honor the
 * transaction's policy.
 */
function completionBlockers(t: TransactionWithRelations): string[] {
  const policy = policyOf(t);
  const reasons: string[] = [];

  const blocking = blockingExceptions(t);
  if (blocking.length > 0) {
    reasons.push(
      `Blocking exception${blocking.length > 1 ? "s" : ""}: ${blocking
        .map((x) => EXCEPTION_META[x.type].label)
        .join(", ")}.`
    );
  }

  const latest = reconciliationsOf(t).at(-1);
  const mismatchOpen = !!latest && latest.result !== "MATCH";
  const mismatchExceptionOpen = t.exceptions.some(
    (x) => x.type === ExceptionType.QUANTITY_MISMATCH && x.status !== ExceptionStatus.RESOLVED
  );
  if (
    mismatchOpen &&
    policy.quantityReconciliationRequired &&
    policy.blockingMismatches &&
    !mismatchExceptionOpen
  ) {
    reasons.push("Reconciliation shows a quantity mismatch that has not been resolved.");
  }

  if (t.state === TransactionState.DELIVERED) {
    for (const evidenceType of REQUIRED_VERIFIED_EVIDENCE) {
      if (!hasVerified(t, evidenceType)) {
        reasons.push(`${evidenceType} has not been verified.`);
      }
    }
    if (policy.quantityReconciliationRequired && !latest) {
      reasons.push("Delivery has not been reconciled against the ordered quantity.");
    }
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function serializeTransaction(t: TransactionWithRelations) {
  const policy = policyOf(t);
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
    policy: {
      ...policy,
      completionCondition: completionConditionText(policy),
    },
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
        severity: x.severity,
        blocking: x.blocking,
        owner: x.owner,
        description: x.description,
        expected: x.expected != null ? Number(x.expected) : null,
        observed: x.observed != null ? Number(x.observed) : null,
        difference: x.difference != null ? Number(x.difference) : null,
        detectedAt: x.detectedAt.toISOString(),
        nextAction: x.nextAction,
        resolutionNote: x.resolutionNote,
        resolvedAt: x.resolvedAt?.toISOString(),
        resolvedBy: x.resolvedBy,
      }))
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)),
    activity: t.activity
      .map((a) => {
        const metadata = (a.metadata ?? null) as Record<string, unknown> | null;
        return {
          id: a.id,
          type: a.type,
          category: activityCategory(a.type),
          actor:
            metadata && typeof metadata.actor === "string" ? metadata.actor : "Nobryn",
          description: a.description,
          metadata,
          createdAt: a.createdAt.toISOString(),
        };
      })
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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
    policyId?: string;
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

  // The transaction executes under an explicit, persisted policy.
  const policyId = await resolvePolicySelection(workspaceId, input.policyId);

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
      policyId,
      items: { create: items },
    },
    include: txInclude,
  });

  await addActivity(tx.id, "TRANSACTION_CREATED", "Transaction created", {
    purchaseOrderNumber: tx.purchaseOrderNumber,
    actor: "Nobryn",
  });

  return getTransactionScoped(workspaceId, tx.id);
}

// ---------------------------------------------------------------------------
// Execution engine: state changes, exceptions, completion, notifications
// ---------------------------------------------------------------------------

async function applyStateChange(
  db: Prisma.TransactionClient,
  transactionId: string,
  from: TransactionState,
  target: TransactionState,
  reason: string
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
      metadata: { actor: "Nobryn", from, to: target, reason } as never,
    },
  });
}

function notificationTypeForException(type: ExceptionType): NotificationType {
  switch (type) {
    case ExceptionType.QUANTITY_MISMATCH:
      return NOTIFICATION_TYPE.QUANTITY_MISMATCH;
    case ExceptionType.SUPPLIER_TIMEOUT:
      return NOTIFICATION_TYPE.SUPPLIER_CONFIRMATION_OVERDUE;
    case ExceptionType.DELIVERY_DELAY:
      return NOTIFICATION_TYPE.DELIVERY_DELAYED;
  }
}

function notificationTitleForException(type: ExceptionType): string {
  switch (type) {
    case ExceptionType.QUANTITY_MISMATCH:
      return "Quantity mismatch detected";
    case ExceptionType.SUPPLIER_TIMEOUT:
      return "Supplier confirmation overdue";
    case ExceptionType.DELIVERY_DELAY:
      return "Delivery delayed";
  }
}

/**
 * System-generated exception creation: records the operational fields
 * (severity, blocking, expected/observed/difference, source) plus the audit
 * event and the notification — atomically with the domain write.
 */
async function createExceptionRecord(
  db: Prisma.TransactionClient,
  tx: TransactionWithRelations,
  type: ExceptionType,
  opts: {
    description?: string;
    nextAction?: string;
    severity?: "LOW" | "MEDIUM" | "HIGH";
    blocking?: boolean;
    owner?: string | null;
    expected?: number;
    observed?: number;
    difference?: number;
    source?: string;
    metadata?: Record<string, unknown>;
  } = {}
) {
  const meta = EXCEPTION_META[type];
  const severity = opts.severity ?? "HIGH";
  const blocking = opts.blocking ?? true;
  const description = opts.description ?? meta.description;

  const exception = await db.exception.create({
    data: {
      transactionId: tx.id,
      type,
      status: ExceptionStatus.OPEN,
      severity: severity as ExceptionSeverity,
      blocking,
      owner: opts.owner ?? null,
      description,
      expected: opts.expected ?? null,
      observed: opts.observed ?? null,
      difference: opts.difference ?? null,
      nextAction: opts.nextAction ?? meta.nextAction,
    },
  });

  await db.activityEvent.create({
    data: {
      transactionId: tx.id,
      type: "EXCEPTION_DETECTED",
      description: `Exception detected: ${meta.label}`,
      metadata: {
        actor: "Nobryn",
        severity,
        blocking,
        ...(opts.source ? { source: opts.source } : {}),
        ...(opts.expected != null ? { expected: opts.expected } : {}),
        ...(opts.observed != null ? { observed: opts.observed } : {}),
        ...(opts.difference != null ? { difference: opts.difference } : {}),
        ...(opts.metadata ?? {}),
      } as never,
    },
  });

  await notify(db, {
    workspaceId: tx.workspaceId,
    transactionId: tx.id,
    type: notificationTypeForException(type),
    severity: type === ExceptionType.DELIVERY_DELAY ? "WARNING" : "ERROR",
    title: notificationTitleForException(type),
    description: `${meta.label}: ${description}${blocking ? " Completion is blocked." : ""}`,
    targetPath: `/app/transactions/${tx.id}`,
  });

  return exception;
}

/**
 * Timer-based detection run by the engine itself (no external event needed):
 *  - SUPPLIER_TIMEOUT when no confirmation arrived within the policy window.
 *  - DELIVERY_DELAY when the expected delivery date passed without delivery.
 */
export async function evaluateAutomaticExceptions(workspaceId: string, id: string) {
  const tx = await getTransactionScoped(workspaceId, id);
  const policy = policyOf(tx);
  const now = Date.now();

  const hasExceptionOf = (type: ExceptionType) =>
    tx.exceptions.some((x) => x.type === type);

  const candidates: { type: ExceptionType; severity: "LOW" | "MEDIUM" | "HIGH"; metadata: Record<string, unknown> }[] = [];

  const confirmationWindowMs = policy.confirmationWindowHours * 60 * 60 * 1000;
  if (
    tx.state === TransactionState.CREATED &&
    !hasVerified(tx, EVIDENCE.supplierConfirmation) &&
    now - tx.createdAt.getTime() > confirmationWindowMs &&
    !hasExceptionOf(ExceptionType.SUPPLIER_TIMEOUT)
  ) {
    candidates.push({
      type: ExceptionType.SUPPLIER_TIMEOUT,
      severity: "HIGH",
      metadata: {
        source: "Nobryn",
        expected: "Supplier confirmation",
        actual: `No confirmation within ${policy.confirmationWindowHours} hours`,
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
      severity: "MEDIUM",
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
      await createExceptionRecord(db, tx, candidate.type, {
        severity: candidate.severity,
        blocking: true,
        source: "Nobryn",
        metadata: candidate.metadata,
      });
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

async function recordIntegrationEvent(
  workspaceId: string,
  transactionId: string,
  row: {
    eventId: string;
    source: string;
    type: string;
    status: string;
    result?: string;
    detail?: string;
  }
) {
  return prisma.integrationEvent.create({
    data: {
      workspaceId,
      transactionId,
      eventId: row.eventId,
      source: row.source,
      type: row.type,
      status: row.status,
      result: row.result ?? null,
      detail: row.detail ?? null,
      processedAt: new Date(),
    },
  });
}

export interface IngestResult {
  transaction: TransactionWithRelations;
  duplicate: boolean;
  awaitingVerification: boolean;
  result: string;
}

export async function ingestExternalEvent(
  workspaceId: string,
  id: string,
  input: { type: ExternalEventType; source?: string; reportedQuantity?: number; eventId?: string },
  adapter: IntegrationAdapter
): Promise<IngestResult> {
  // 404 happens before any event record: an unauthorized target never creates
  // provenance rows in the caller's workspace.
  const tx = await getTransactionScoped(workspaceId, id);
  const def = EVENT_CATALOG[input.type];

  try {
    // Adapter boundary: translate the raw payload into the normalized model.
    const event = adapter.normalize(input);
    const source = event.source;
    const eventRef = def.evidenceType ? makeReference(def.referencePrefix) : "";
    // Stable identifier: explicit when provided, deterministic otherwise.
    const eventId = event.eventId?.trim() || `${source}:${def.type}:${tx.id}`;
    // ---- Idempotency: a processed event id is never processed twice. ----
    const prior = await prisma.integrationEvent.findFirst({
      where: { workspaceId, eventId, status: EVENT_STATUS.PROCESSED },
    });
    if (prior) {
      await recordIntegrationEvent(workspaceId, tx.id, {
        eventId,
        source,
        type: def.type,
        status: EVENT_STATUS.DUPLICATE,
        result: EVENT_RESULT.IGNORED,
        detail: "Event id already processed.",
      });
      return {
        transaction: tx,
        duplicate: true,
        awaitingVerification: false,
        result: EVENT_RESULT.IGNORED,
      };
    }

    // ---- Type-level duplicate suppression (claims are recorded once). ----
    if (def.evidenceType && tx.evidence.some((e) => e.type === def.evidenceType)) {
      await recordIntegrationEvent(workspaceId, tx.id, {
        eventId,
        source,
        type: def.type,
        status: EVENT_STATUS.DUPLICATE,
        result: EVENT_RESULT.IGNORED,
        detail: "Claim already recorded for this transaction.",
      });
      return {
        transaction: tx,
        duplicate: true,
        awaitingVerification: false,
        result: EVENT_RESULT.IGNORED,
      };
    }
    if (
      def.exceptionType &&
      tx.exceptions.some((x) => x.type === def.exceptionType)
    ) {
      await recordIntegrationEvent(workspaceId, tx.id, {
        eventId,
        source,
        type: def.type,
        status: EVENT_STATUS.DUPLICATE,
        result: EVENT_RESULT.IGNORED,
        detail: "Exception already raised for this transaction.",
      });
      return {
        transaction: tx,
        duplicate: true,
        awaitingVerification: false,
        result: EVENT_RESULT.IGNORED,
      };
    }

    // ---- Validation against the execution rules (throws -> REJECTED). ----
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

    const policy = policyOf(tx);
    let result: string = EVENT_RESULT.CLAIM_CREATED;
    let awaitingVerification = false;

    await prisma.$transaction(async (db) => {
      // 1. Record the claim exactly as the external source reported it.
      await db.activityEvent.create({
        data: {
          transactionId: tx.id,
          type: "CLAIM_RECEIVED",
          description: def.claimDescription.replace("{source}", source),
          metadata: {
            actor: source,
            source,
            type: def.type,
            eventId,
            ...(eventRef ? { reference: eventRef } : {}),
            ...(event.reportedQuantity != null
              ? { reportedQuantity: event.reportedQuantity }
              : {}),
          } as never,
        },
      });

      // 2. Exception-producing events become system-generated exceptions.
      if (def.exceptionType) {
        result = EVENT_RESULT.EXCEPTION_CREATED;
        await createExceptionRecord(db, tx, def.exceptionType, {
          source,
          metadata: {
            expected:
              def.exceptionType === ExceptionType.SUPPLIER_TIMEOUT
                ? "Supplier confirmation"
                : "Delivery claim by the expected delivery date",
            actual: def.summary,
          },
          ...(def.exceptionType === ExceptionType.SUPPLIER_TIMEOUT
            ? { severity: "HIGH" as const, blocking: true }
            : { severity: "MEDIUM" as const, blocking: true }),
        });
        return;
      }

      // 3. CLAIM != VERIFICATION. Human confirmation is required for delivery
      //    claims unless the policy says delivery confirmation is not required.
      const needsHuman =
        def.verification === "HUMAN" &&
        (def.type !== "DELIVERY_REPORTED" || policy.deliveryConfirmationRequired);
      const automatic = !needsHuman;
      const evidenceType =
        def.evidenceType === EVIDENCE.deliveryClaim && automatic
          ? EVIDENCE.deliveryConfirmation
          : (def.evidenceType as string);

      const notes = automatic
        ? def.type === "DELIVERY_REPORTED"
          ? `Received from ${source}. Auto-verified under policy: delivery confirmation is not required.${
              event.reportedQuantity != null
                ? ` Reported quantity: ${event.reportedQuantity} units.`
                : ""
            }`
          : `Received from ${source}. Verified automatically under the execution rules.`
        : event.reportedQuantity != null
          ? `Reported quantity: ${event.reportedQuantity} units. Awaiting human verification.`
          : `Reported by ${source}. Awaiting human verification.`;

      await db.evidence.create({
        data: {
          transactionId: tx.id,
          type: evidenceType,
          source,
          reference: evidenceType === EVIDENCE.deliveryConfirmation ? makeReference("GRN-") : eventRef,
          verified: automatic,
          notes,
        },
      });

      if (needsHuman) {
        awaitingVerification = true;
        await notify(db, {
          workspaceId: tx.workspaceId,
          transactionId: tx.id,
          type: NOTIFICATION_TYPE.VERIFICATION_REQUIRED,
          severity: "WARNING",
          title: "Delivery reported — confirmation required",
          description: `${source} reported${
            event.reportedQuantity != null ? ` ${event.reportedQuantity} units` : ""
          } delivered. Verification is required before the transaction can continue.`,
          targetPath: `/app/transactions/${tx.id}`,
        });
        return;
      }

      // 4. Automatic verification recorded by the execution rules.
      await db.activityEvent.create({
        data: {
          transactionId: tx.id,
          type: "EVENT_VERIFIED",
          description: `${def.label} verified automatically (${source})`,
          metadata: { actor: "Nobryn", source } as never,
        },
      });

      if (def.type === "DELIVERY_REPORTED") {
        // Policy does not require human confirmation: observed reality is the
        // reported claim, reconciled immediately, then the state advances.
        const expected = expectedQuantity(tx);
        const observed = round2(event.reportedQuantity ?? expected);
        const difference = round2(observed - expected);
        const withinTolerance =
          Math.abs(difference) <= policy.quantityTolerance + 1e-9;
        const match = withinTolerance;

        await db.activityEvent.create({
          data: {
            transactionId: tx.id,
            type: "CLAIM_VERIFIED",
            description: "Delivery confirmed automatically (policy does not require confirmation)",
            metadata: { actor: "Nobryn", source } as never,
          },
        });
        await db.activityEvent.create({
          data: {
            transactionId: tx.id,
            type: "RECONCILED",
            description: reconciliationDescription(expected, observed, difference, match),
            metadata: {
              actor: "Nobryn",
              expected,
              received: observed,
              difference,
              result: match ? "MATCH" : "MISMATCH",
              tolerance: policy.quantityTolerance,
              withinTolerance,
              source,
            } as never,
          },
        });

        if (match) {
          await applyStateChange(
            db,
            tx.id,
            tx.state,
            TransactionState.DELIVERED,
            "Delivery auto-verified and reconciled"
          );
          await runCompletionEvaluation(db, tx.id);
        } else if (!policy.quantityReconciliationRequired) {
          await applyStateChange(
            db,
            tx.id,
            tx.state,
            TransactionState.DELIVERED,
            "Quantity reconciliation is not required by policy"
          );
          await runCompletionEvaluation(db, tx.id);
        } else {
          result = EVENT_RESULT.EXCEPTION_CREATED;
          await createExceptionRecord(db, tx, ExceptionType.QUANTITY_MISMATCH, {
            description: `Expected ${expected} units, received ${observed} units (difference ${difference} units).`,
            severity: "HIGH",
            blocking: policy.blockingMismatches,
            owner: source,
            expected,
            observed,
            difference,
            source: "Reconciliation",
          });
          if (!policy.blockingMismatches) {
            await applyStateChange(
              db,
              tx.id,
              tx.state,
              TransactionState.DELIVERED,
              "Non-blocking quantity mismatch accepted by policy"
            );
            await runCompletionEvaluation(db, tx.id);
          }
        }
        return;
      }

      // 5. Advance the state machine only where the execution rules allow it.
      if (
        def.stateEffect &&
        def.expectedState &&
        tx.state === def.expectedState &&
        NEXT_STATE[tx.state] === def.stateEffect
      ) {
        await applyStateChange(
          db,
          tx.id,
          tx.state,
          def.stateEffect,
          `${def.label} verified automatically`
        );
      }
    });

    await recordIntegrationEvent(workspaceId, tx.id, {
      eventId,
      source,
      type: def.type,
      status: EVENT_STATUS.PROCESSED,
      result,
      detail: def.evidenceType
        ? `Claim ${eventRef || "(recorded)"}`
        : EXCEPTION_META[def.exceptionType as ExceptionType].label,
    });

    await evaluateAutomaticExceptions(workspaceId, id);
    const updated = await getTransactionScoped(workspaceId, id);
    return { transaction: updated, duplicate: false, awaitingVerification, result };
  } catch (err) {
    // Invalid events are rejected safely and stay observable.
    if (err instanceof ApiError && err.status < 500) {
      const source =
        input.source && def.sources.includes(input.source) ? input.source : def.source;
      const eventId = input.eventId?.trim() || `${source}:${def.type}:${tx.id}`;
      await recordIntegrationEvent(workspaceId, tx.id, {
        eventId,
        source,
        type: def.type,
        status: EVENT_STATUS.REJECTED,
        result: EVENT_RESULT.REJECTED,
        detail: err.message,
      });
      await addActivity(tx.id, "EVENT_REJECTED", `Event rejected: ${def.label} — ${err.message}`, {
        actor: source,
        source,
        eventId,
      });
      await notify(prisma, {
        workspaceId,
        transactionId: tx.id,
        type: NOTIFICATION_TYPE.EVENT_REJECTED,
        severity: "WARNING",
        title: "Integration event rejected",
        description: `${def.label} from ${source} was rejected: ${err.message}`,
        targetPath: `/app/transactions/${tx.id}`,
      });
    }
    throw err;
  }
}

function reconciliationDescription(
  expected: number,
  observed: number,
  difference: number,
  match: boolean,
  approved = false
): string {
  const base = `${expected} ordered / ${observed} received`;
  if (match) {
    return `Delivery reconciled: ${base} — MATCH${approved ? "" : difference !== 0 ? " (within tolerance)" : ""}`;
  }
  return `Delivery reconciled: ${base} — MISMATCH (difference ${difference})`;
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

  const policy = policyOf(tx);
  const expected = expectedQuantity(tx);
  const received = round2(input.receivedQuantity);
  const difference = round2(received - expected);
  const withinTolerance = Math.abs(difference) <= policy.quantityTolerance + 1e-9;
  const result: "MATCH" | "MISMATCH" = withinTolerance ? "MATCH" : "MISMATCH";
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
          actor: verifiedBy,
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
        description: reconciliationDescription(expected, received, difference, result === "MATCH"),
        metadata: {
          actor: "Nobryn",
          expected,
          received,
          difference,
          result,
          tolerance: policy.quantityTolerance,
          withinTolerance,
          source: claim.source,
        } as never,
      },
    });

    await notify(db, {
      workspaceId: tx.workspaceId,
      transactionId: tx.id,
      type: NOTIFICATION_TYPE.VERIFICATION_COMPLETED,
      severity: "INFO",
      title: "Delivery verified",
      description: `${expected} expected / ${received} observed — ${result}.`,
      targetPath: `/app/transactions/${tx.id}`,
    });

    if (result === "MATCH") {
      await applyStateChange(
        db,
        tx.id,
        tx.state,
        TransactionState.DELIVERED,
        "Delivery verified and reconciled"
      );
      await runCompletionEvaluation(db, tx.id);
    } else if (!policy.quantityReconciliationRequired) {
      await applyStateChange(
        db,
        tx.id,
        tx.state,
        TransactionState.DELIVERED,
        "Quantity reconciliation is not required by policy"
      );
      await runCompletionEvaluation(db, tx.id);
    } else {
      await createExceptionRecord(db, tx, ExceptionType.QUANTITY_MISMATCH, {
        description: `Expected ${expected} units, received ${received} units (difference ${difference} units).`,
        severity: "HIGH",
        blocking: policy.blockingMismatches,
        owner: verifiedBy,
        expected,
        observed: received,
        difference,
        source: "Reconciliation",
      });
      if (!policy.blockingMismatches) {
        await applyStateChange(
          db,
          tx.id,
          tx.state,
          TransactionState.DELIVERED,
          "Non-blocking quantity mismatch accepted by policy"
        );
        await runCompletionEvaluation(db, tx.id);
      }
    }

    return db.transaction.findUniqueOrThrow({
      where: { id: tx.id },
      include: txInclude,
    });
  });
}

/**
 * Completion requires every policy-relevant condition to hold — it can never
 * be triggered by a generic "complete" action.
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
      metadata: { actor: "Nobryn" } as never,
    },
  });
  await applyStateChange(
    db,
    transactionId,
    tx.state,
    TransactionState.COMPLETED,
    "Completion conditions satisfied"
  );
  await notify(db, {
    workspaceId: tx.workspaceId,
    transactionId,
    type: NOTIFICATION_TYPE.TRANSACTION_COMPLETED,
    severity: "INFO",
    title: "Transaction completed",
    description: `${tx.purchaseOrderNumber} satisfied all completion conditions.`,
    targetPath: `/app/transactions/${transactionId}`,
  });
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
      metadata: { actor: "Nobryn" } as never,
    },
  });

  if (tx.state === TransactionState.FULFILLING) {
    if (!hasVerified(tx, EVIDENCE.deliveryConfirmation)) return;
    if (blockingExceptions(tx).length > 0) return;

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
            actor: "Nobryn",
            expected: latest.expected,
            received: latest.received,
            difference: latest.difference,
            result: "MATCH",
            approved: true,
          } as never,
        },
      });
    }

    await applyStateChange(
      db,
      transactionId,
      tx.state,
      TransactionState.DELIVERED,
      "Exception resolved; reconciliation approved"
    );
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
        metadata: { actor: resolvedBy, resolutionNote } as never,
      },
    });
    await notify(db, {
      workspaceId,
      transactionId: exception.transactionId,
      type: NOTIFICATION_TYPE.EXCEPTION_RESOLVED,
      severity: "INFO",
      title: "Blocking exception resolved",
      description: `${EXCEPTION_META[exception.type].label} resolved by ${resolvedBy}.`,
      targetPath: `/app/transactions/${exception.transactionId}`,
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
    severity: x.severity,
    blocking: x.blocking,
    owner: x.owner,
    description: x.description,
    expected: x.expected != null ? Number(x.expected) : null,
    observed: x.observed != null ? Number(x.observed) : null,
    difference: x.difference != null ? Number(x.difference) : null,
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
