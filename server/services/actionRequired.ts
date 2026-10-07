import { prisma } from "../prisma.js";
import { ExceptionSeverity, ExceptionStatus } from "@prisma/client";
import { EVENT_STATUS, type ExceptionType } from "../domain.js";
import { resolvePolicy } from "./policies.js";

export interface ActionRequiredItem {
  id: string;
  kind: "VERIFICATION" | "EXCEPTION" | "EVENT";
  severity: "LOW" | "MEDIUM" | "HIGH";
  transactionId: string | null;
  purchaseOrderNumber: string;
  title: string;
  description: string;
  why: string;
  status: string;
  nextAction: string;
  targetPath: string;
  detectedAt: string;
}

const EXCEPTION_ACTION_TITLE: Record<ExceptionType, string> = {
  QUANTITY_MISMATCH: "Quantity mismatch detected",
  SUPPLIER_TIMEOUT: "Supplier confirmation overdue",
  DELIVERY_DELAY: "Delivery delayed",
};

const SEVERITY_RANK: Record<ActionRequiredItem["severity"], number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

/**
 * Action Required is derived from live domain state — pending verifications,
 * open exceptions and rejected events — so items appear when work is needed
 * and disappear automatically once the blocking condition is resolved.
 * Ordinary activity never becomes an action item.
 */
export async function deriveActionRequired(workspaceId: string): Promise<ActionRequiredItem[]> {
  const items: ActionRequiredItem[] = [];

  const transactions = await prisma.transaction.findMany({
    where: { workspaceId },
    include: { evidence: true, exceptions: true, policy: true, activity: true },
  });

  for (const tx of transactions) {
    // Delivery claim awaiting human verification (only while still unverified).
    const claim = tx.evidence.find(
      (e) => e.type === "Delivery reported" && !e.verified
    );
    const deliveryVerified = tx.evidence.some(
      (e) => e.verified && e.type === "Delivery confirmation"
    );
    if (claim && !deliveryVerified) {
      const policy = resolvePolicy(tx.policy);
      const overdue =
        Date.now() - claim.receivedAt.getTime() >
        policy.confirmationWindowHours * 60 * 60 * 1000;
      const act = tx.activity.find((a) => {
        const m = (a.metadata ?? null) as Record<string, unknown> | null;
        return a.type === "CLAIM_RECEIVED" && m?.reference === claim.reference;
      });
      const m = (act?.metadata ?? null) as Record<string, unknown> | null;
      const reported = m && typeof m.reportedQuantity === "number" ? m.reportedQuantity : null;
      items.push({
        id: `verify:${tx.id}`,
        kind: "VERIFICATION",
        severity: overdue ? "HIGH" : "MEDIUM",
        transactionId: tx.id,
        purchaseOrderNumber: tx.purchaseOrderNumber,
        title: overdue
          ? "Delivery confirmation overdue"
          : "Delivery reported — confirmation required",
        description: `${claim.source} reported${reported != null ? ` ${reported} units` : ""} delivered.`,
        why: overdue
          ? `Confirmation was expected within ${policy.confirmationWindowHours} hours of the claim.`
          : "Verification is required before the transaction can continue.",
        status: "Awaiting verification",
        nextAction: "Confirm delivery",
        targetPath: `/app/transactions/${tx.id}`,
        detectedAt: claim.receivedAt.toISOString(),
      });
    }

    // Open (unresolved) exceptions.
    for (const x of tx.exceptions) {
      if (x.status === ExceptionStatus.RESOLVED) continue;
      items.push({
        id: `exception:${x.id}`,
        kind: "EXCEPTION",
        severity:
          x.severity === ExceptionSeverity.HIGH
            ? "HIGH"
            : x.severity === ExceptionSeverity.LOW
              ? "LOW"
              : "MEDIUM",
        transactionId: tx.id,
        purchaseOrderNumber: tx.purchaseOrderNumber,
        title: EXCEPTION_ACTION_TITLE[x.type],
        description: `${x.description}${x.blocking ? " Completion is blocked." : ""}`,
        why: x.blocking
          ? "This exception blocks completion until it is resolved."
          : "Review recommended; completion is not blocked.",
        status: x.status,
        nextAction: x.nextAction ?? "Review exception",
        targetPath: `/app/transactions/${tx.id}`,
        detectedAt: x.detectedAt.toISOString(),
      });
    }
  }

  // Rejected integration events need investigation.
  const rejected = await prisma.integrationEvent.findMany({
    where: { workspaceId, status: EVENT_STATUS.REJECTED },
    include: { transaction: { select: { purchaseOrderNumber: true } } },
    orderBy: { receivedAt: "desc" },
    take: 10,
  });
  for (const row of rejected) {
    items.push({
      id: `event:${row.id}`,
      kind: "EVENT",
      severity: "MEDIUM",
      transactionId: row.transactionId,
      purchaseOrderNumber: row.transaction?.purchaseOrderNumber ?? "External event",
      title: "Integration event rejected",
      description: `${row.source} event ${row.type} was rejected.${row.detail ? ` ${row.detail}` : ""}`,
      why: "The event could not be processed; review it and resend.",
      status: "Rejected",
      nextAction: "Inspect the rejected event",
      targetPath: row.transactionId
        ? `/app/transactions/${row.transactionId}`
        : "/app/integrations",
      detectedAt: row.receivedAt.toISOString(),
    });
  }

  items.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.detectedAt.localeCompare(a.detectedAt)
  );
  return items.slice(0, 12);
}
