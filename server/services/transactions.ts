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
  EXCEPTION_META,
  EXECUTION_STEPS,
  NEXT_STATE,
  REQUIRED_EVIDENCE_FOR_COMPLETION,
  STATE_ORDER,
} from "../domain.js";

export type TransactionWithRelations = Transaction & {
  counterparty: Counterparty;
  items: TransactionItem[];
  evidence: Evidence[];
  exceptions: Exception[];
  activity: ActivityEvent[];
};

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
  };
}

export type SerializedTransaction = ReturnType<typeof serializeTransaction>;

const txInclude = {
  counterparty: true,
  items: true,
  evidence: true,
  exceptions: true,
  activity: true,
} as const;

async function getTransactionScoped(workspaceId: string, id: string) {
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
// State machine + simulated execution engine
// ---------------------------------------------------------------------------

function nextStepFor(state: TransactionState) {
  return EXECUTION_STEPS[state];
}

export async function advanceTransaction(
  workspaceId: string,
  id: string,
  targetState: TransactionState
) {
  const tx = await getTransactionScoped(workspaceId, id);

  const expected = NEXT_STATE[tx.state as keyof typeof NEXT_STATE];
  if (!expected || expected !== targetState) {
    if (targetState === "COMPLETED" && tx.state !== "DELIVERED") {
      throw new ApiError(
        409,
        "A transaction cannot be completed before delivery has been verified."
      );
    }
    throw new ApiError(
      409,
      `A transaction in state ${tx.state} cannot move directly to ${targetState}.`
    );
  }

  // Completion is evidence-based: require a verified delivery confirmation.
  if (targetState === TransactionState.COMPLETED) {
    const openBlocking = tx.exceptions.some(
      (x) => x.status === ExceptionStatus.OPEN || x.status === ExceptionStatus.IN_PROGRESS
    );
    if (openBlocking) {
      throw new ApiError(
        409,
        "This transaction cannot be completed while a blocking exception is open."
      );
    }
    const deliveryEvidence = tx.evidence.find(
      (e) => e.type === REQUIRED_EVIDENCE_FOR_COMPLETION && e.verified
    );
    if (!deliveryEvidence) {
      throw new ApiError(
        409,
        "A verified delivery confirmation is required before this transaction can be completed."
      );
    }
  }

  const step = nextStepFor(tx.state);

  return prisma.$transaction(async (db) => {
    // Evidence recorded by the simulated execution engine for this transition.
    if (step) {
      await db.evidence.create({
        data: {
          transactionId: tx.id,
          type: step.evidenceType,
          source: step.source,
          reference: `${step.referencePrefix}${Math.floor(100000 + Math.random() * 899999)}`,
          verified: true,
          notes: `Recorded via simulated ${step.source}.`,
        },
      });
    }

    await db.transaction.update({
      where: { id: tx.id },
      data: { state: targetState },
    });

    if (step) {
      await db.activityEvent.create({
        data: {
          transactionId: tx.id,
          type: step.activityType,
          description: step.activityDescription,
        },
      });
    }
    await db.activityEvent.create({
      data: {
        transactionId: tx.id,
        type: "STATE_CHANGED",
        description: `Transaction moved to ${stateLabel(targetState)}`,
      },
    });

    // When delivery is confirmed, run the quantity verification check that can
    // surface a quantity mismatch exception (deterministic demo behavior).
    if (targetState === TransactionState.DELIVERED && tx.purchaseOrderNumber === "PO-10482") {
      await createExceptionRecord(db, tx.id, ExceptionType.QUANTITY_MISMATCH);
    }

    return db.transaction.findUniqueOrThrow({
      where: { id: tx.id },
      include: txInclude,
    });
  });
}

async function createExceptionRecord(
  db: Prisma.TransactionClient,
  transactionId: string,
  type: ExceptionType,
  descriptionOverride?: string,
  nextActionOverride?: string
) {
  const meta = EXCEPTION_META[type];
  return db.exception.create({
    data: {
      transactionId,
      type,
      status: ExceptionStatus.OPEN,
      description: descriptionOverride ?? meta.description,
      nextAction: nextActionOverride ?? meta.nextAction,
    },
  });
}

export async function recordManualEvidence(
  workspaceId: string,
  id: string,
  input: { type: string; source: string; reference: string; notes?: string }
) {
  await getTransactionScoped(workspaceId, id);
  const evidence = await prisma.evidence.create({
    data: {
      transactionId: id,
      type: input.type,
      source: input.source,
      reference: input.reference,
      notes: input.notes,
      verified: true,
    },
  });
  await addActivity(id, "EVIDENCE_RECEIVED", `Evidence received: ${input.type}`, {
    evidenceId: evidence.id,
  });
  return evidence;
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export async function createSimulatedException(
  workspaceId: string,
  transactionId: string,
  type: ExceptionType
) {
  await getTransactionScoped(workspaceId, transactionId);
  const created = await prisma.$transaction(async (db) => {
    const exception = await createExceptionRecord(db, transactionId, type);
    await db.activityEvent.create({
      data: {
        transactionId,
        type: "EXCEPTION_DETECTED",
        description: `Exception detected: ${EXCEPTION_META[type].label}`,
      },
    });
    return exception;
  });
  return created;
}

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
        metadata: { resolutionNote } as never,
      },
    });
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

export { getTransactionScoped, addActivity };
