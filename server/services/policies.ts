import { prisma } from "../prisma.js";
import type { TransactionPolicy } from "@prisma/client";
import { ApiError } from "../errors.js";
import { DEFAULT_POLICY, completionConditionText, type PolicyValues } from "../domain.js";

export interface PolicyInput {
  name: string;
  deliveryConfirmationRequired: boolean;
  quantityReconciliationRequired: boolean;
  quantityTolerance: number;
  confirmationWindowHours: number;
  blockingMismatches: boolean;
}

export function policyValuesFromRow(row: TransactionPolicy): PolicyValues {
  return {
    id: row.id,
    name: row.name,
    deliveryConfirmationRequired: row.deliveryConfirmationRequired,
    quantityReconciliationRequired: row.quantityReconciliationRequired,
    quantityTolerance: Number(row.quantityTolerance),
    confirmationWindowHours: row.confirmationWindowHours,
    blockingMismatches: row.blockingMismatches,
  };
}

/** Null policy (legacy rows) falls back to the built-in default values. */
export function resolvePolicy(policy: TransactionPolicy | null | undefined): PolicyValues {
  if (!policy) return { ...DEFAULT_POLICY };
  return policyValuesFromRow(policy);
}

export function serializePolicy(row: TransactionPolicy) {
  const values = policyValuesFromRow(row);
  return { ...values, completionCondition: completionConditionText(values) };
}

/** Lazily create the workspace's default policy (persists even for pre-existing workspaces). */
export async function ensureDefaultPolicy(workspaceId: string): Promise<TransactionPolicy> {
  const existing = await prisma.transactionPolicy.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return prisma.transactionPolicy.create({
    data: {
      workspaceId,
      name: DEFAULT_POLICY.name,
      deliveryConfirmationRequired: DEFAULT_POLICY.deliveryConfirmationRequired,
      quantityReconciliationRequired: DEFAULT_POLICY.quantityReconciliationRequired,
      quantityTolerance: DEFAULT_POLICY.quantityTolerance,
      confirmationWindowHours: DEFAULT_POLICY.confirmationWindowHours,
      blockingMismatches: DEFAULT_POLICY.blockingMismatches,
    },
  });
}

export async function listPolicies(workspaceId: string) {
  await ensureDefaultPolicy(workspaceId);
  const rows = await prisma.transactionPolicy.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(serializePolicy);
}

export async function createPolicy(workspaceId: string, input: PolicyInput) {
  const row = await prisma.transactionPolicy.create({
    data: { workspaceId, ...input },
  });
  return serializePolicy(row);
}

export async function updatePolicy(workspaceId: string, id: string, input: PolicyInput) {
  const existing = await prisma.transactionPolicy.findFirst({
    where: { id, workspaceId },
  });
  if (!existing) {
    throw new ApiError(404, "Unable to find this policy.");
  }
  const updated = await prisma.transactionPolicy.update({ where: { id }, data: input });
  return serializePolicy(updated);
}

/**
 * Resolve which policy a new transaction executes under: an explicit selection
 * must belong to the workspace, otherwise the workspace default is attached so
 * every transaction always has a persisted policy.
 */
export async function resolvePolicySelection(
  workspaceId: string,
  policyId?: string
): Promise<string> {
  if (!policyId) {
    const fallback = await ensureDefaultPolicy(workspaceId);
    return fallback.id;
  }
  const row = await prisma.transactionPolicy.findFirst({
    where: { id: policyId, workspaceId },
  });
  if (!row) {
    throw new ApiError(400, "Policy not found in this workspace.", {
      policyId: "Unknown policy.",
    });
  }
  return row.id;
}
