import { Router } from "express";
import { ExceptionStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { ApiError, asyncHandler, parseWith } from "../errors.js";
import { requireAuth, requireWorkspace, type AuthedRequest } from "../auth.js";
import {
  counterpartySchema,
  createTransactionSchema,
  ingestEventSchema,
  policySchema,
  resolveExceptionSchema,
  TransactionState as TxState,
  updateAccountSchema,
  updateWorkspaceSchema,
  verifyDeliverySchema,
} from "../domain.js";
import {
  createTransaction,
  getTransactionForDisplay,
  getTransactionScoped,
  ingestExternalEvent,
  listExceptions,
  resolveException,
  serializeTransaction,
  verifyDelivery,
} from "../services/transactions.js";
import {
  createPolicy,
  listPolicies,
  updatePolicy,
} from "../services/policies.js";
import { getOverview } from "../services/overview.js";
import { observabilityRouter } from "./observability.js";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from "../services/notifications.js";
import { simulatorAdapter } from "../integrations/simulator.js";

export const apiRouter = Router();

// Everything below requires a valid token and a resolved workspace.
const workspaceRouter = Router();
workspaceRouter.use(requireAuth, requireWorkspace);
apiRouter.use(workspaceRouter);

// Health/latency snapshot for Nobryn's internal operational dashboard.
// Mounted after the auth stack above, so it is session-protected; the public
// monitor target is `GET /health` (see routes/health.ts).
apiRouter.use("/observability", observabilityRouter);

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
    // Two independent, indexed queries instead of loading every transaction's
    // updatedAt row per counterparty: row count and latest activity.
    const [counterparties, activity] = await Promise.all([
      prisma.counterparty.findMany({
        where: { workspaceId },
        select: {
          id: true,
          companyName: true,
          contactName: true,
          email: true,
          createdAt: true,
          _count: { select: { transactions: true } },
        },
        orderBy: { companyName: "asc" },
      }),
      prisma.transaction.groupBy({
        by: ["counterpartyId"],
        where: { workspaceId },
        _max: { updatedAt: true },
      }),
    ]);
    const lastActivity = new Map(
      activity.map((row) => [row.counterpartyId, row._max.updatedAt])
    );
    res.json(
      counterparties.map((c) => ({
        id: c.id,
        companyName: c.companyName,
        contactName: c.contactName,
        email: c.email,
        createdAt: c.createdAt.toISOString(),
        transactionCount: c._count.transactions,
        lastActivity: lastActivity.get(c.id)?.toISOString() ?? null,
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
      // Projection: only the columns the list renders (plus the counterparty
      // name) — no full-row reads and no relation tree.
      select: {
        id: true,
        purchaseOrderNumber: true,
        description: true,
        amount: true,
        currency: true,
        state: true,
        expectedDeliveryDate: true,
        updatedAt: true,
        counterparty: { select: { companyName: true } },
      },
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
    const id = param(req, "id");
    // Detail payload and event provenance are independent (both are keyed by
    // the transaction id in the URL), so they are fetched concurrently.
    const [tx, events] = await Promise.all([
      getTransactionForDisplay(workspaceId, id),
      prisma.integrationEvent.findMany({
        where: { workspaceId, transactionId: id },
        orderBy: { receivedAt: "desc" },
        take: 30,
      }),
    ]);
    res.json({
      transaction: {
        ...serializeTransaction(tx),
        events: events.map((e) => ({
          id: e.id,
          eventId: e.eventId,
          source: e.source,
          type: e.type,
          receivedAt: e.receivedAt.toISOString(),
          processedAt: e.processedAt?.toISOString() ?? null,
          status: e.status,
          result: e.result,
          detail: e.detail,
        })),
      },
    });
  })
);

/**
 * Event ingestion: adapters (today the simulator, real systems later) publish
 * events/claims here. The adapter normalizes the payload; the domain then
 * validates, records the claim, verifies where required, reconciles and
 * updates state — the pipeline every future integration will use.
 */
workspaceRouter.post(
  "/transactions/:id/events",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const input = parseWith(ingestEventSchema, req.body);
    const result = await ingestExternalEvent(
      workspaceId,
      param(req, "id"),
      input,
      simulatorAdapter
    );
    res.status(result.duplicate ? 200 : 201).json({
      transaction: serializeTransaction(result.transaction),
      duplicate: result.duplicate,
      awaitingVerification: result.awaitingVerification,
      result: result.result,
    });
  })
);

/**
 * Human confirmation of a delivery claim: the user records what was actually
 * received. Nobryn reconciles observed vs expected and handles the resulting
 * state change — the user never operates the state machine directly.
 */
workspaceRouter.post(
  "/transactions/:id/verify",
  asyncHandler(async (req, res) => {
    const { workspaceId, userName } = ctx(req);
    const input = parseWith(verifyDeliverySchema, req.body);
    const tx = await verifyDelivery(workspaceId, param(req, "id"), input, userName);
    res.json({ transaction: serializeTransaction(tx) });
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

// ---------------------------------------------------------------------------
// Exceptions — created by the execution engine, resolved by humans
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Transaction policies (validated server-side, persisted per workspace)
// ---------------------------------------------------------------------------

workspaceRouter.get(
  "/policies",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    res.json({ policies: await listPolicies(workspaceId) });
  })
);

workspaceRouter.post(
  "/policies",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const input = parseWith(policySchema, req.body);
    res.status(201).json({ policy: await createPolicy(workspaceId, input) });
  })
);

workspaceRouter.patch(
  "/policies/:id",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const input = parseWith(policySchema, req.body);
    res.json({ policy: await updatePolicy(workspaceId, param(req, "id"), input) });
  })
);

// ---------------------------------------------------------------------------
// Notifications (generated from domain events)
// ---------------------------------------------------------------------------

workspaceRouter.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const { unread } = req.query as { unread?: string };
    const [notifications, unreadCount] = await Promise.all([
      listNotifications(workspaceId, { unreadOnly: unread === "1" || unread === "true" }),
      unreadNotificationCount(workspaceId),
    ]);
    res.json({ notifications, unreadCount });
  })
);

workspaceRouter.get(
  "/notifications/unread-count",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    res.json({ unreadCount: await unreadNotificationCount(workspaceId) });
  })
);

workspaceRouter.post(
  "/notifications/read-all",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    res.json(await markAllNotificationsRead(workspaceId));
  })
);

workspaceRouter.post(
  "/notifications/:id/read",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    res.json({ notification: await markNotificationRead(workspaceId, param(req, "id")) });
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
// Overview (page-level) + summary
// ---------------------------------------------------------------------------

/**
 * Page-level endpoint for the Overview route: metrics, recent transactions,
 * open exceptions, action required and the activity feed in one response,
 * assembled concurrently by the overview service. This replaces the previous
 * pattern of fetching `/api/summary` and then the entire `/api/transactions`
 * list just to render eight activity rows.
 */
workspaceRouter.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    res.json(await getOverview(workspaceId));
  })
);

/** Legacy summary payload (same data as `/overview` minus `recentActivity`). */
workspaceRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const { workspaceId } = ctx(req);
    const overview = await getOverview(workspaceId);
    res.json({
      cards: overview.cards,
      recentTransactions: overview.recentTransactions,
      openExceptions: overview.openExceptions,
      actionRequired: overview.actionRequired,
    });
  })
);
