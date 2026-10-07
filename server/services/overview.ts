import { prisma } from "../prisma.js";
import { ExceptionStatus, TransactionState } from "@prisma/client";
import { deriveActionRequired } from "./actionRequired.js";

/**
 * Overview page assembly.
 *
 * One function, one round of concurrent queries: everything the Overview
 * route shows (metric cards, recent transactions, open exceptions, action
 * required and the activity feed) is resolved with `Promise.all`, so the
 * frontend needs a single request instead of one call per section.
 *
 * Every query stays workspace-scoped and returns only the fields the page
 * actually renders.
 */
export interface OverviewResult {
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
    type: string;
    status: string;
    detectedAt: string;
    nextAction?: string | null;
  }[];
  actionRequired: Awaited<ReturnType<typeof deriveActionRequired>>;
  /** Most recently updated transactions — powers the activity feed (8 rows). */
  recentActivity: {
    id: string;
    purchaseOrderNumber: string;
    state: TransactionState;
    updatedAt: string;
  }[];
}

const RECENT_TRANSACTION_ROWS = 5;
const ACTIVITY_ROWS = 8;

export async function getOverview(workspaceId: string): Promise<OverviewResult> {
  const [activeTransactions, openExceptions, completed, counterparties, recent, openList, actionRequired] =
    await Promise.all([
      prisma.transaction.count({
        where: { workspaceId, state: { not: TransactionState.COMPLETED } },
      }),
      prisma.exception.count({
        where: { transaction: { workspaceId }, status: { not: ExceptionStatus.RESOLVED } },
      }),
      prisma.transaction.count({ where: { workspaceId, state: TransactionState.COMPLETED } }),
      prisma.counterparty.count({ where: { workspaceId } }),
      // One query feeds both the recent-transactions card list (first 5) and
      // the activity feed (8) — no second full-table read for the same page.
      prisma.transaction.findMany({
        where: { workspaceId },
        select: {
          id: true,
          purchaseOrderNumber: true,
          amount: true,
          currency: true,
          state: true,
          updatedAt: true,
          counterparty: { select: { companyName: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: ACTIVITY_ROWS,
      }),
      prisma.exception.findMany({
        where: { transaction: { workspaceId }, status: { not: ExceptionStatus.RESOLVED } },
        select: {
          id: true,
          type: true,
          status: true,
          detectedAt: true,
          nextAction: true,
          transaction: { select: { id: true, purchaseOrderNumber: true } },
        },
        orderBy: { detectedAt: "desc" },
        take: 5,
      }),
      deriveActionRequired(workspaceId),
    ]);

  return {
    cards: {
      activeTransactions,
      exceptions: openExceptions,
      completed,
      counterparties,
    },
    recentTransactions: recent.slice(0, RECENT_TRANSACTION_ROWS).map((t) => ({
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
    actionRequired,
    recentActivity: recent.map((t) => ({
      id: t.id,
      purchaseOrderNumber: t.purchaseOrderNumber,
      state: t.state,
      updatedAt: t.updatedAt.toISOString(),
    })),
  };
}
