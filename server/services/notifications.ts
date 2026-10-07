import { prisma } from "../prisma.js";
import { NotificationSeverity, Prisma } from "@prisma/client";
import { ApiError } from "../errors.js";
import type { NotificationType } from "../domain.js";

/**
 * Notifications are generated from domain events (claims awaiting verification,
 * exceptions, completions, rejected events) — never from UI state.
 *
 * `notify` runs inside the same transaction as the domain write that caused it,
 * so a rolled-back operation never leaves a notification behind. While an
 * unread notification of the same type already exists for a transaction, a
 * new one is not created (no noise for repeated states).
 */
export async function notify(
  db: Prisma.TransactionClient,
  n: {
    workspaceId: string;
    transactionId?: string;
    type: NotificationType;
    severity: "INFO" | "WARNING" | "ERROR";
    title: string;
    description: string;
    targetPath: string;
  }
) {
  const existing = await db.notification.findFirst({
    where: {
      workspaceId: n.workspaceId,
      type: n.type,
      readAt: null,
      ...(n.transactionId ? { transactionId: n.transactionId } : {}),
    },
    select: { id: true },
  });
  if (existing) return null;
  return db.notification.create({
    data: {
      workspaceId: n.workspaceId,
      transactionId: n.transactionId,
      type: n.type,
      severity: n.severity as NotificationSeverity,
      title: n.title,
      description: n.description,
      targetPath: n.targetPath,
    },
  });
}

function serialize(n: {
  id: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  description: string;
  targetPath: string;
  transactionId: string | null;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: n.id,
    type: n.type,
    severity: n.severity,
    title: n.title,
    description: n.description,
    targetPath: n.targetPath,
    transactionId: n.transactionId,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

export async function listNotifications(
  workspaceId: string,
  opts: { unreadOnly?: boolean } = {}
) {
  const rows = await prisma.notification.findMany({
    where: { workspaceId, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map(serialize);
}

export async function unreadNotificationCount(workspaceId: string) {
  return prisma.notification.count({ where: { workspaceId, readAt: null } });
}

export async function markNotificationRead(workspaceId: string, id: string) {
  const existing = await prisma.notification.findFirst({ where: { id, workspaceId } });
  if (!existing) {
    throw new ApiError(404, "Unable to find this notification.");
  }
  if (existing.readAt) return serialize(existing);
  const updated = await prisma.notification.update({
    where: { id },
    data: { readAt: new Date() },
  });
  return serialize(updated);
}

export async function markAllNotificationsRead(workspaceId: string) {
  await prisma.notification.updateMany({
    where: { workspaceId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: true };
}
