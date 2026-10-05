import { Router } from "express";
import { TransactionState, ExceptionStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { ApiError, asyncHandler, parseWith } from "../errors.js";
import { requireAuth, requireWorkspace, type AuthedRequest } from "../auth.js";
import {
  advanceStateSchema,
  counterpartySchema,
  createTransactionSchema,
  evidenceSchema,
  resolveExceptionSchema,
  simulateExceptionSchema,
  TransactionState as TxState,
  updateAccountSchema,
  updateWorkspaceSchema,
} from "../domain.js";
import {
  advanceTransaction,
  createSimulatedException,
  createTransaction,
  getTransactionScoped,
  listExceptions,
  recordManualEvidence,
  resolveException,
  serializeTransaction,
} from "../services/transactions.js";

export const apiRouter = Router();

// Everything below requires a valid token and a resolved workspace.
const workspaceRouter = Router();
workspaceRouter.use(requireAuth, requireWorkspace);
apiRouter.use(workspaceRouter);

/**
 * After requireAuth + requireWorkspace have run, every handler receives an
 * authed request carrying the user and the resolved workspace id.
 */
function ctx(req: AuthedRequest): { workspaceId: string; userId: string; userName: string } {
  if (!req.workspaceId || !req.user) {
    throw new ApiError(401, "You must be signed in to do that.");
  }
  return {
    workspaceId: req.workspaceId,
    userId: req.user.id,
    userName: `${req.user.firstName} ${req.user.lastName}`.trim(),
  };
}

function param(req: AuthedRequest, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}

// ---------------------------------------------------------------------------
// Workspace + account
// ---------------------------------------------------------------------------

workspaceRouter.get(
  "/workspace",
  asyncHandler(async (req, res) => {
    const { workspaceId, userId } = ctx(req);
    const workspace = await prisma.workspace.findFirstOrThrow({
      where: { id: workspaceId, ownerId: userId },
    });
    const [transactionCount, counterpartyCount] = await Promise.all([
      prisma.transaction.count({ where: { workspaceId } }),
      prisma.counterparty.count({ where: { workspaceId } }),
    ]);
    res.json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        createdAt: workspace.createdAt.toISOString(),
      },
      counts: { transactions: transactionCount, counterparties: counterpartyCount },
    });
  })
);

workspaceRouter.patch(
  "/workspace",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const input = parseWith(updateWorkspaceSchema, req.body);
    const workspace = await prisma.workspace.update({
      where: { id: workspaceId },
      data: { name: input.name },
    });
    res.json({ workspace: { id: workspace.id, name: workspace.name } });
  })
);

workspaceRouter.patch(
  "/account",
  asyncHandler(async (req, res) => {
    const { userId } = ctx(req);
    const input = parseWith(updateAccountSchema, req.body);
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { firstName: input.firstName, lastName: input.lastName },
    });
    res.json({
      user: {
        id: updated.id,
        firstName: updated.firstName,
        lastName: updated.lastName,
        email: updated.email,
      },
    });
  })
);

// ---------------------------------------------------------------------------
// Counterparties
// ---------------------------------------------------------------------------

workspaceRouter.get(
  "/counterparties",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const counterparties = await prisma.counterparty.findMany({
      where: { workspaceId },
      include: { transactions: { select: { updatedAt: true } } },
      orderBy: { companyName: "asc" },
    });
    res.json(
      counterparties.map((c) => ({
        id: c.id,
        companyName: c.companyName,
        contactName: c.contactName,
        email: c.email,
        createdAt: c.createdAt.toISOString(),
        transactionCount: c.transactions.length,
        lastActivity: c.transactions.length
          ? c.transactions.map((t) => t.updatedAt.toISOString()).sort().at(-1)!
          : null,
      }))
    );
  })
);

workspaceRouter.post(
  "/counterparties",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const input = parseWith(counterpartySchema, req.body);
    const counterparty = await prisma.counterparty.create({
      data: { workspaceId, ...input },
    });
    res.status(201).json({
      counterparty: {
        id: counterparty.id,
        companyName: counterparty.companyName,
        contactName: counterparty.contactName,
        email: counterparty.email,
      },
    });
  })
);

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

workspaceRouter.get(
  "/transactions",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const { search, state } = req.query as { search?: string; state?: string };
    const where: Record<string, unknown> = { workspaceId };
    if (state && state !== "ALL") {
      if (!Object.values(TxState).includes(state as TxState)) {
        throw new ApiError(400, "Unknown transaction state filter.");
      }
      where.state = state;
    }
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { purchaseOrderNumber: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { counterparty: { companyName: { contains: q, mode: "insensitive" } } },
      ];
    }
    const transactions = await prisma.transaction.findMany({
      where,
      include: { counterparty: true },
      orderBy: { updatedAt: "desc" },
    });
    res.json(
      transactions.map((t) => ({
        id: t.id,
        purchaseOrderNumber: t.purchaseOrderNumber,
        counterpartyName: t.counterparty.companyName,
        description: t.description,
        amount: Number(t.amount),
        currency: t.currency,
        state: t.state,
        expectedDeliveryDate: t.expectedDeliveryDate.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      }))
    );
  })
);

workspaceRouter.post(
  "/transactions",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const input = parseWith(createTransactionSchema, req.body);
    const tx = await createTransaction(workspaceId, input);
    res.status(201).json({ transaction: serializeTransaction(tx) });
  })
);

workspaceRouter.get(
  "/transactions/:id",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const tx = await getTransactionScoped(workspaceId, param(req, "id"));
    res.json({ transaction: serializeTransaction(tx) });
  })
);

workspaceRouter.patch(
  "/transactions/:id/state",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const input = parseWith(advanceStateSchema, req.body);
    const tx = await advanceTransaction(workspaceId, param(req, "id"), input.state);
    res.json({ transaction: serializeTransaction(tx) });
  })
);

workspaceRouter.post(
  "/transactions/:id/execute",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const { NEXT_STATE } = await import("../domain.js");
    const current = await getTransactionScoped(workspaceId, param(req, "id"));
    const next = NEXT_STATE[current.state];
    if (!next) {
      throw new ApiError(409, "This transaction has already completed.");
    }
    const tx = await advanceTransaction(workspaceId, param(req, "id"), next);
    res.json({ transaction: serializeTransaction(tx) });
  })
);

workspaceRouter.post(
  "/transactions/:id/verify",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const tx = await getTransactionScoped(workspaceId, param(req, "id"));
    const deliveryEvidence = tx.evidence.find(
      (e) => e.type === "Delivery confirmation" && e.verified
    );
    if (!deliveryEvidence) {
      throw new ApiError(
        409,
        "A verified delivery confirmation is required before this transaction can be completed."
      );
    }
    res.json({ verified: true, evidenceId: deliveryEvidence.id });
  })
);

workspaceRouter.get(
  "/transactions/:id/evidence",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const tx = await getTransactionScoped(workspaceId, param(req, "id"));
    res.json({ evidence: serializeTransaction(tx).evidence });
  })
);

workspaceRouter.post(
  "/transactions/:id/evidence",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const input = parseWith(evidenceSchema, req.body);
    const evidence = await recordManualEvidence(workspaceId, param(req, "id"), input);
    res.status(201).json({
      evidence: { ...evidence, receivedAt: evidence.receivedAt.toISOString() },
    });
  })
);

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

workspaceRouter.get(
  "/exceptions",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const { status } = req.query as { status?: string };
    let statusFilter: ExceptionStatus | undefined;
    if (status && status !== "ALL") {
      statusFilter = status as ExceptionStatus;
    }
    res.json(await listExceptions(workspaceId, statusFilter));
  })
);

workspaceRouter.post(
  "/transactions/:id/exceptions",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const input = parseWith(simulateExceptionSchema, req.body);
    const exception = await createSimulatedException(workspaceId, param(req, "id"), input.type);
    res.status(201).json({ exception });
  })
);

workspaceRouter.post(
  "/exceptions/:id/resolve",
  asyncHandler(async (req, res) => {
    const { workspaceId, userName } = ctx(req);
    const input = parseWith(resolveExceptionSchema, req.body);
    const exception = await resolveException(
      workspaceId,
      param(req, "id"),
      input.resolutionNote,
      userName
    );
    res.json({ exception });
  })
);

// ---------------------------------------------------------------------------
// Overview summary
// ---------------------------------------------------------------------------

workspaceRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const [activeTransactions, openExceptions, completed, counterparties, recent, openList] =
      await Promise.all([
        prisma.transaction.count({
          where: { workspaceId, state: { not: TransactionState.COMPLETED } },
        }),
        prisma.exception.count({
          where: { transaction: { workspaceId }, status: { not: ExceptionStatus.RESOLVED } },
        }),
        prisma.transaction.count({ where: { workspaceId, state: TransactionState.COMPLETED } }),
        prisma.counterparty.count({ where: { workspaceId } }),
        prisma.transaction.findMany({
          where: { workspaceId },
          include: { counterparty: true },
          orderBy: { updatedAt: "desc" },
          take: 5,
        }),
        prisma.exception.findMany({
          where: { transaction: { workspaceId }, status: { not: ExceptionStatus.RESOLVED } },
          include: { transaction: { select: { id: true, purchaseOrderNumber: true } } },
          orderBy: { detectedAt: "desc" },
          take: 5,
        }),
      ]);
    res.json({
      cards: {
        activeTransactions,
        exceptions: openExceptions,
        completed,
        counterparties,
      },
      recentTransactions: recent.map((t) => ({
        id: t.id,
        purchaseOrderNumber: t.purchaseOrderNumber,
        counterpartyName: t.counterparty.companyName,
        amount: Number(t.amount),
        currency: t.currency,
        state: t.state,
        updatedAt: t.updatedAt.toISOString(),
      })),
      openExceptions: openList.map((x) => ({
        id: x.id,
        transactionId: x.transaction.id,
        purchaseOrderNumber: x.transaction.purchaseOrderNumber,
        type: x.type,
        status: x.status,
        detectedAt: x.detectedAt.toISOString(),
        nextAction: x.nextAction,
      })),
    });
  })
);
