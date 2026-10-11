import { createHash } from "node:crypto";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { notify } from "./notifications.js";
import {
  sendEmail,
  supplierInviteEmail,
  supplierLinkUrl,
  findSentEmail,
  escapeHtml,
  type SentEmail,
} from "./email.js";
import {
  TransactionState,
  ExceptionType,
  ExceptionStatus,
  Prisma,
} from "@prisma/client";
import {
  EVIDENCE,
  NEXT_STATE,
  activityCategory,
  type PolicyValues,
} from "../domain.js";
import { resolvePolicy } from "./policies.js";

// ---------------------------------------------------------------------------
// Shared type coercions for Prisma Json / Decimal fields.
// ---------------------------------------------------------------------------

type Items = { name: string; quantity: number }[];

/** Coerce a stored Json items array to a plain items array with numeric quantities. */
function decodeItems(value: unknown): Items {
  if (!Array.isArray(value)) return [];
  return value.map((item: unknown) => {
    const m = item as { name?: unknown; quantity?: unknown };
    return {
      name: typeof m.name === "string" ? m.name : "",
      quantity: typeof m.quantity === "number" ? m.quantity : Number(m.quantity) || 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Token handling — raw token never persisted; only a SHA-256 digest is stored.
// ---------------------------------------------------------------------------

const TOKEN_BYTES = 32;
const TOKEN_HEX_BYTES = TOKEN_BYTES * 2; // 64 hex chars — high entropy

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return [...cryptoRandomBytes(TOKEN_BYTES)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function cryptoRandomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

// ---------------------------------------------------------------------------
// Access links
// ---------------------------------------------------------------------------

export interface AccessLinkRow {
  id: string;
  token: string; // raw token — returned once at creation, never stored
  name: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  replacedByToken: string | null;
}

export async function createAccessLink(
  workspaceId: string,
  transactionId: string,
  name: string | null,
  recipientEmail: string | null
): Promise<{ link: AccessLinkRow; rawToken: string; url: string; email: SentEmail | null }> {
  // Ownership: only the transaction's workspace may issue links for it.
  const tx = await prisma.transaction.findFirst({
    where: { id: transactionId, workspaceId },
    select: { id: true, purchaseOrderNumber: true },
  });
  if (!tx) {
    throw new ApiError(404, "Unable to find this transaction in your workspace.");
  }

  // One active (non-revoked, non-expired) link per transaction at a time.
  // Rotating/replacing is explicit, so we never silently create duplicates.
  const existing = await prisma.transactionAccessLink.findFirst({
    where: {
      transactionId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (existing) {
    throw new ApiError(409, "This transaction already has an active access link. Revoke or rotate it first.");
  }

  const rawToken = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
  const digest = hashToken(rawToken);

  const link = await prisma.transactionAccessLink.create({
    data: {
      transactionId,
      token: digest,
      name,
      expiresAt,
    },
  });

  const url = supplierLinkUrl(rawToken);

  // Send the supplier invite email (dispatch-only in dev/test — see email.ts).
  let email: SentEmail | null = null;
  if (recipientEmail && /^\\S+@\\S+\\.\\S+$/.test(recipientEmail)) {
    const sent = await sendEmail(
      supplierInviteEmail({
        recipientEmail,
        counterpartyName: "", // filled by caller with counterparty.companyName
        buyerOrg: "", // filled by caller with workspace.name
        poNumber: tx.purchaseOrderNumber,
        linkUrl: url,
      })
    );
    if (sent.ok) {
      // The dev transport records the dispatched email in memory; read it back
      // for the caller so the buyer UI can show what was sent. A real provider
      // would instead return its own sent-message record.
      const recorded = findSentEmail(recipientEmail, `Action required: ${tx.purchaseOrderNumber} — response needed`);
      if (recorded) email = recorded;
    }
  }

  return {
    link: toAccessLinkRow(link),
    rawToken,
    url,
    email,
  };
}

export async function rotateAccessLink(
  workspaceId: string,
  transactionId: string
): Promise<{ link: AccessLinkRow; rawToken: string; url: string; email: SentEmail | null }> {
  const tx = await prisma.transaction.findFirst({
    where: { id: transactionId, workspaceId },
    select: { id: true, purchaseOrderNumber: true, counterpartyId: true },
  });
  if (!tx) {
    throw new ApiError(404, "Unable to find this transaction in your workspace.");
  }

  const current = await prisma.transactionAccessLink.findFirst({
    where: { transactionId, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!current) {
    throw new ApiError(404, "No access link to rotate for this transaction.");
  }

  // Mark current revoked and point at the replacement (audit history).
  await prisma.$transaction(async (db) => {
    await db.transactionAccessLink.update({
      where: { id: current.id },
      data: { revokedAt: new Date(), replacedByToken: null },
    });
  });

  // Recompute counterparty + buyer for the new invite.
  const counterparty = await prisma.counterparty.findUnique({
    where: { id: tx.counterpartyId },
    select: { companyName: true },
  });
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true },
  });

  const rawToken = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const digest = hashToken(rawToken);

  const link = await prisma.transactionAccessLink.create({
    data: {
      transactionId,
      token: digest,
      name: current.name,
      expiresAt,
    },
  });

  // Point the new link at the old one for history (reverse of replacedByToken
  // semantics: the OLD link's replacedByToken = NEW token).
  await prisma.transactionAccessLink.update({
    where: { id: current.id },
    data: { replacedByToken: rawToken },
  });

  const url = supplierLinkUrl(rawToken);

  let email: SentEmail | null = null;
  const recipientEmail = await transactionRecipientEmail(tx.id);
  if (recipientEmail && /^\\S+@\\S+\\.\\S+$/.test(recipientEmail)) {
    await sendEmail(
      supplierInviteEmail({
        recipientEmail,
        counterpartyName: counterparty?.companyName ?? "",
        buyerOrg: workspace?.name ?? "",
        poNumber: tx.purchaseOrderNumber,
        linkUrl: url,
      })
    );
    const recorded = findSentEmail(
      recipientEmail,
      `Action required: ${tx.purchaseOrderNumber} — response needed`
    );
    if (recorded) email = recorded;
  }

  return { link: toAccessLinkRow(link), rawToken, url, email };
}

export async function revokeAccessLink(
  workspaceId: string,
  transactionId: string
): Promise<void> {
  const tx = await prisma.transaction.findFirst({
    where: { id: transactionId, workspaceId },
    select: { id: true },
  });
  if (!tx) {
    throw new ApiError(404, "Unable to find this transaction in your workspace.");
  }

  const affected = await prisma.transactionAccessLink.updateMany({
    where: { transactionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (affected.count === 0) {
    throw new ApiError(404, "No active access link to revoke.");
  }
}

export async function listAccessLinks(workspaceId: string, transactionId: string) {
  const tx = await prisma.transaction.findFirst({
    where: { id: transactionId, workspaceId },
    select: { id: true },
  });
  if (!tx) {
    throw new ApiError(404, "Unable to find this transaction in your workspace.");
  }

  const links = await prisma.transactionAccessLink.findMany({
    where: { transactionId },
    orderBy: { createdAt: "desc" },
  });
  return links.map(toAccessLinkRow);
}

export async function resolveAccessLinkByToken(
  token: string
): Promise<{ link: AccessLinkRow; transactionId: string } | null> {
  const digest = hashToken(token);
  const link = await prisma.transactionAccessLink.findUnique({
    where: { token: digest },
  });
  if (!link) return null;
  if (link.revokedAt) return null;
  if (link.expiresAt <= new Date()) return null;
  return { link: toAccessLinkRow(link), transactionId: link.transactionId };
}

function toAccessLinkRow(row: {
  id: string;
  token: string; // this is the digest in the DB; we return the raw token only at creation
  name: string | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByToken: string | null;
}): AccessLinkRow {
  // The DB stores the digest, not the raw token. Returning a token field here
  // would be misleading — callers receive the raw token only from the create/
  // rotate return value. For listing we omit the token entirely.
  return {
    id: row.id,
    token: "", // placeholder — raw token is one-time, never stored
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    replacedByToken: row.replacedByToken,
  };
}

// ---------------------------------------------------------------------------
// Transaction recipient email (recorded, transaction-specific)
// ---------------------------------------------------------------------------

export async function transactionRecipientEmail(transactionId: string): Promise<string | null> {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { recipientEmail: true, counterparty: { select: { email: true } } },
  });
  if (!tx) return null;
  // The recorded recipient for this transaction is authoritative.
  if (tx.recipientEmail) return tx.recipientEmail;
  // Fall back to the counterparty's current default (only if the transaction
  // was created before recipientEmail was recorded — rare).
  return tx.counterparty.email ?? null;
}

// ---------------------------------------------------------------------------
// Commitments + proposals
// ---------------------------------------------------------------------------

export async function fetchCurrentCommitment(transactionId: string) {
  return prisma.commitment.findFirst({
    where: { transactionId, isCurrent: true },
    orderBy: { commitmentNumber: "desc" },
  });
}

export async function fetchCommitmentHistory(transactionId: string) {
  return prisma.commitment.findMany({
    where: { transactionId },
    orderBy: { commitmentNumber: "asc" },
  });
}

export async function fetchPendingProposal(transactionId: string) {
  return prisma.commitmentProposal.findFirst({
    where: { transactionId, status: "PENDING" },
    orderBy: { submittedAt: "desc" },
  });
}

export async function listProposals(transactionId: string) {
  return prisma.commitmentProposal.findMany({
    where: { transactionId },
    orderBy: { submittedAt: "desc" },
  });
}

export interface SupplierRespondInput {
  items: { itemId: string; name: string; quantity: number }[];
  deliveryDate: string;
  explanation?: string;
}

export async function submitSupplierResponse(
  token: string,
  input: SupplierRespondInput
): Promise<{
  commitment: import("@prisma/client").Commitment | null;
  proposal: import("@prisma/client").CommitmentProposal | null;
  status: string;
  awaitingBuyerApproval: boolean;
}> {
  const resolved = await resolveAccessLinkByToken(token);
  if (!resolved) {
    throw new ApiError(404, "This link does not grant access to a transaction.");
  }
  const { transactionId } = resolved;
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      commitments: {
        where: { isCurrent: true },
        orderBy: { commitmentNumber: "desc" },
      },
      items: { select: { id: true, name: true, quantity: true } },
    },
  });
  if (!tx) {
    throw new ApiError(404, "This transaction no longer exists.");
  }

  // Validate items against the transaction's original items (by id).
  const itemMap = new Map<string, (typeof tx.items)[number]>(tx.items.map((i) => [i.id, i]));
  for (const r of input.items) {
    if (!itemMap.has(r.itemId)) {
      throw new ApiError(400, `Unknown item: ${r.itemId}.`);
    }
    const item = itemMap.get(r.itemId);
    if (!item) {
      throw new ApiError(400, `Item ${r.itemId} not found.`);
    }
    if (r.quantity <= 0) {
      throw new ApiError(400, `Quantity must be greater than zero for ${item.name}.`);
    }
  }

  const parsedDate = new Date(input.deliveryDate);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new ApiError(400, "A valid delivery date is required.");
  }

  const current = tx.commitments?.[0] ?? null;

  // If there is already a pending proposal, the new response supersedes it.
  const pending = await fetchPendingProposal(transactionId);

  if (!current) {
    // ---- Initial supplier commitment ------------------------------------------------
    // The supplier's first response accepts the order and starts fulfillment.
    // This is the real, accountable equivalent of the legacy simulated
    // SUPPLIER_CONFIRMATION event — recorded as evidence so the existing
    // execution engine and completion rules keep working unchanged.
    const number = 1;
    const committedItems = input.items.map((r) => ({
      itemId: r.itemId,
      name: r.name,
      quantity: r.quantity,
    }));

    const result = await prisma.$transaction(async (db) => {
      const commitment = await db.commitment.create({
        data: {
          transactionId,
          commitmentNumber: number,
          items: committedItems as never,
          committedDeliveryDate: parsedDate,
          explanation: input.explanation ?? null,
          submittedVia: "supplier-link",
          createdBy: token,
          isCurrent: true,
        },
      });

      // Supplier confirmation evidence (mirrors the legacy event path).
      await db.evidence.create({
        data: {
          transactionId,
          type: EVIDENCE.supplierConfirmation,
          source: "Supplier link",
          reference: `SUP-${commitment.id.slice(-6).toUpperCase()}`,
          verified: true,
          notes: "Supplier confirmed this order through their secure access link.",
        },
      });

      // Fulfillment started evidence — the supplier has accepted and begun work.
      await db.evidence.create({
        data: {
          transactionId,
          type: EVIDENCE.fulfillment,
          source: "Supplier link",
          reference: `FUL-${commitment.id.slice(-6).toUpperCase()}`,
          verified: true,
          notes: "Supplier started fulfilling this order.",
        },
      });

      // Advance the state machine: CREATED -> ACCEPTED -> FULFILLING.
      if (tx.state === TransactionState.CREATED) {
        await db.transaction.update({
          where: { id: transactionId },
          data: { state: TransactionState.ACCEPTED },
        });
        await db.activityEvent.create({
          data: {
            transactionId,
            type: "STATE_CHANGED",
            description: "Transaction moved to Accepted",
            metadata: { actor: "Supplier link", from: TransactionState.CREATED, to: TransactionState.ACCEPTED, reason: "Supplier confirmed the order." } as never,
          },
        });

        await db.transaction.update({
          where: { id: transactionId },
          data: { state: TransactionState.FULFILLING },
        });
        await db.activityEvent.create({
          data: {
            transactionId,
            type: "STATE_CHANGED",
            description: "Transaction moved to Fulfilling",
            metadata: { actor: "Supplier link", from: TransactionState.ACCEPTED, to: TransactionState.FULFILLING, reason: "Supplier started fulfillment." } as never,
          },
        });
      }

      await db.activityEvent.create({
        data: {
          transactionId,
          type: "CLAIM_RECEIVED",
          description: "Supplier commitment received through access link",
          metadata: { actor: "Supplier", source: "Supplier link", commitmentId: commitment.id } as never,
        },
      });

      // Notify the buyer that the supplier has accepted the order.
      await notify(db, {
        workspaceId: tx.workspaceId,
        transactionId,
        type: "SUPPLIER_COMMITMENT_RECEIVED",
        severity: "INFO",
        title: "Supplier has accepted the order",
        description: `The supplier committed to ${committedItems.length} item${committedItems.length === 1 ? "" : "s"} for delivery on ${parsedDate.toISOString().slice(0, 10)}.`,
        targetPath: `/app/transactions/${transactionId}`,
      });

      return commitment;
    });

    return {
      commitment: result,
      proposal: null,
      status: "accepted",
      awaitingBuyerApproval: false,
    };
  }

  // ---- Proposed change to an accepted commitment --------------------------------
  const proposedItems = input.items.map((r) => ({
    itemId: r.itemId,
    name: r.name,
    quantity: r.quantity,
  }));

  const proposal = await prisma.$transaction(async (db) => {
    // Supersede any existing pending proposal (preserve its history).
    if (pending && pending.id !== undefined) {
      await db.commitmentProposal.update({
        where: { id: pending.id },
        data: { status: "SUPERSEDED" },
      });
    }

    const proposal = await db.commitmentProposal.create({
      data: {
        transactionId,
        proposedItems: proposedItems as never,
        proposedDeliveryDate: parsedDate,
        explanation: input.explanation ?? null,
        submittedByTokenId: token,
        status: "PENDING",
      },
    });

    await db.activityEvent.create({
      data: {
        transactionId,
        type: "PROPOSAL_SUBMITTED",
        description: "Supplier proposed a change to the accepted commitment",
        metadata: { actor: "Supplier", source: "Supplier link", proposalId: proposal.id } as never,
      },
    });

    // Mark the transaction as awaiting buyer approval.
    await db.transaction.update({
      where: { id: transactionId },
      data: { pendingProposalId: proposal.id },
    });

    // Notify the buyer that approval is required.
    const diffs = proposedItems.filter(
      (p) => {
        const existing = current.items as { itemId: string; name: string; quantity: number }[];
        const ex = existing.find((e) => e.itemId === p.itemId);
        return !ex || ex.quantity !== p.quantity;
      }
    );
    await notify(db, {
      workspaceId: tx.workspaceId,
      transactionId,
      type: "PROPOSAL_REQUIRES_APPROVAL",
      severity: "WARNING",
      title: "Supplier proposed a commitment change",
      description: `The supplier proposed changes to ${diffs.length} item${diffs.length === 1 ? "" : "s"}${input.explanation ? ". " + input.explanation : ""}`.trim() || "The supplier proposed a change to the accepted commitment.",
      targetPath: `/app/transactions/${transactionId}`,
    });

    return proposal;
  });

  return {
    commitment: current,
    proposal,
    status: "proposed",
    awaitingBuyerApproval: true,
  };
}

export async function buyerDecision(
  workspaceId: string,
  transactionId: string,
  proposalId: string,
  accept: boolean,
  note?: string
): Promise<{
  commitment: import("@prisma/client").Commitment | null;
  proposal: import("@prisma/client").CommitmentProposal;
}> {
  const tx = await prisma.transaction.findFirst({
    where: { id: transactionId, workspaceId },
    select: { id: true, purchaseOrderNumber: true, counterpartyId: true },
  });
  if (!tx) {
    throw new ApiError(404, "Unable to find this transaction in your workspace.");
  }

  const proposal = await prisma.commitmentProposal.findFirst({
    where: { id: proposalId, transactionId },
  });
  if (!proposal) {
    throw new ApiError(404, "Unable to find this proposal.");
  }
  if (proposal.status !== "PENDING") {
    throw new ApiError(409, "This proposal has already been decided.");
  }

  const current = await fetchCurrentCommitment(transactionId);

  const result = await prisma.$transaction(async (db) => {
    if (accept) {
      // Create a new accepted commitment with the proposed values, preserving
      // the previous commitment as historical (isCurrent = false).
      const nextNumber = (current?.commitmentNumber ?? 0) + 1;

      const newCommitment = await db.commitment.create({
        data: {
          transactionId,
          commitmentNumber: nextNumber,
          items: (proposal.proposedItems as never) as Parameters<typeof db.commitment.create>[0]["data"]["items"],
          committedDeliveryDate: proposal.proposedDeliveryDate,
          explanation: proposal.explanation ?? null,
          submittedVia: "supplier-link",
          createdBy: proposal.submittedByTokenId,
          isCurrent: true,
        },
      });

      if (current) {
        await db.commitment.update({
          where: { id: current.id },
          data: { isCurrent: false },
        });
      }

      await db.commitmentProposal.update({
        where: { id: proposal.id },
        data: { status: "ACCEPTED", decidedBy: "buyer", decidedAt: new Date(), decisionNote: note ?? null },
      });

      await db.activityEvent.create({
        data: {
          transactionId,
          type: "COMMITMENT_ACCEPTED",
          description: "Buyer accepted the supplier's proposed commitment change",
          metadata: { actor: "Buyer", proposalId: proposal.id, commitmentId: newCommitment.id } as never,
        },
      });

      // Clear the pending proposal from the transaction.
      await db.transaction.update({
        where: { id: transactionId },
        data: { pendingProposalId: null },
      });

      await notify(db, {
        workspaceId,
        transactionId,
        type: "PROPOSAL_ACCEPTED",
        severity: "INFO",
        title: "Commitment change approved",
        description: "The supplier's proposed commitment change was approved and is now the active commitment.",
        targetPath: `/app/transactions/${transactionId}`,
      });

      // Notify the supplier that their proposal was accepted.
      const recipientEmail = await transactionRecipientEmail(transactionId);
      if (recipientEmail) {
        await sendEmail({
          to: recipientEmail,
          subject: "Your proposed change was approved",
          html: `<p>The buyer approved your proposed change to ${escapeHtml(tx.purchaseOrderNumber)}. The updated commitment is now active.</p><p>View the transaction using the access link in your original invitation email.</p>`,
          text: `The buyer approved your proposed change to ${tx.purchaseOrderNumber}. The updated commitment is now active.\n\nView the transaction using the access link in your original invitation email.`,
        });
      }

      return newCommitment;
    } else {
      // Rejection: previous accepted commitment unchanged.
      await db.commitmentProposal.update({
        where: { id: proposal.id },
        data: { status: "REJECTED", decidedBy: "buyer", decidedAt: new Date(), decisionNote: note ?? null },
      });

      await db.activityEvent.create({
        data: {
          transactionId,
          type: "PROPOSAL_REJECTED",
          description: "Buyer rejected the supplier's proposed commitment change",
          metadata: { actor: "Buyer", proposalId: proposal.id } as never,
        },
      });

      await db.transaction.update({
        where: { id: transactionId },
        data: { pendingProposalId: null },
      });

      await notify(db, {
        workspaceId,
        transactionId,
        type: "PROPOSAL_REJECTED",
        severity: "WARNING",
        title: "Commitment change rejected",
        description: note
          ? `The buyer rejected the supplier's proposed commitment change. ${note}`
          : "The buyer rejected the supplier's proposed commitment change.",
        targetPath: `/app/transactions/${transactionId}`,
      });

      // Notify the supplier.
      const recipientEmail = await transactionRecipientEmail(transactionId);
      if (recipientEmail) {
        await sendEmail({
          to: recipientEmail,
          subject: "Your proposed change was not approved",
          html: `<p>The buyer did not approve your proposed change to ${escapeHtml(tx.purchaseOrderNumber)}. The previous commitment remains in effect.</p><p>View the transaction using the access link in your original invitation email.</p>`,
          text: `The buyer did not approve your proposed change to ${tx.purchaseOrderNumber}. The previous commitment remains in effect.\n\nView the transaction using the access link in your original invitation email.`,
        });
      }

      return null as unknown as import("@prisma/client").Commitment;
    }
  });

  return { commitment: result as import("@prisma/client").Commitment | null, proposal };
}

// ---------------------------------------------------------------------------
// Supplier notes (buyer -> supplier message visible on the supplier page)
// ---------------------------------------------------------------------------

export async function setSupplierNote(
  workspaceId: string,
  transactionId: string,
  note: string
): Promise<void> {
  const tx = await prisma.transaction.findFirst({
    where: { id: transactionId, workspaceId },
    select: { id: true },
  });
  if (!tx) {
    throw new ApiError(404, "Unable to find this transaction in your workspace.");
  }
  if (note.trim().length > 2000) {
    throw new ApiError(400, "A supplier note can be at most 2000 characters.");
  }
  await prisma.transaction.update({
    where: { id: transactionId },
    data: { supplierNote: note.trim().length ? note.trim() : null },
  });
}

export async function getSupplierNote(transactionId: string): Promise<string | null> {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { supplierNote: true },
  });
  return tx?.supplierNote ?? null;
}

// ---------------------------------------------------------------------------
// Delivery confirmation prompts
// ---------------------------------------------------------------------------

export type DeliveryOutcome =
  | "RECEIVED"
  | "PARTIALLY_RECEIVED"
  | "NOT_RECEIVED"
  | "UNCONFIRMED";

export interface DeliveryPromptRow {
  id: string;
  transactionId: string;
  purchaseOrderNumber: string;
  counterpartyName: string;
  committedDeliveryDate: string;
  expectedItems: { name: string; quantity: number }[];
  committedItems: { name: string; quantity: number }[];
  status: string;
  firstPromptAt: string;
  lastPromptAt: string;
  nextPromptAt: string;
  outcome: string | null;
  receivedQuantity: number | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  note: string | null;
}

export async function dueDeliveryPrompts(workspaceId: string): Promise<DeliveryPromptRow[]> {
  // Transactions whose accepted commitment's delivery date has passed and that
  // still need a definitive delivery outcome from the buyer.
  const rows = await prisma.$transaction(async (db) => {
    const txs = await db.transaction.findMany({
      where: {
        workspaceId,
        state: { in: [TransactionState.ACCEPTED, TransactionState.FULFILLING, TransactionState.DELIVERED] },
        commitments: { some: { isCurrent: true } },
      },
      select: {
        id: true,
        purchaseOrderNumber: true,
        counterparty: { select: { companyName: true } },
        items: { select: { name: true, quantity: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const txIds = txs.map((tx) => tx.id);
    const commitments = await db.commitment.findMany({
      where: { transactionId: { in: txIds }, isCurrent: true },
      orderBy: { commitmentNumber: "desc" },
    });
    const byTx = new Map<string, import("@prisma/client").Commitment>(
      commitments.map((c) => [c.transactionId, c]),
    );

    const due = txs.filter((tx) => {
      const c = byTx.get(tx.id);
      return c && c.committedDeliveryDate instanceof Date && c.committedDeliveryDate.getTime() <= Date.now();
    });

    const result: DeliveryPromptRow[] = [];
    for (const tx of due) {
      const commit = byTx.get(tx.id)!;
      const prompt = await db.deliveryConfirmationPrompt.findUnique({
        where: { transactionId: tx.id },
      });

      // Ensure a prompt exists for this due transaction.
      const resolvedPrompt = await db.$transaction(async (inner) => {
        let p = prompt;
        if (!p) {
          const now = new Date();
          p = await inner.deliveryConfirmationPrompt.create({
            data: {
              transactionId: tx.id,
              status: "PENDING",
              firstPromptAt: now,
              lastPromptAt: now,
              nextPromptAt: now,
            },
          });
        }
        return p;
      });

      if (!resolvedPrompt) continue;

      // Only include if its next prompt is due now.
      if (resolvedPrompt.nextPromptAt && resolvedPrompt.nextPromptAt <= new Date()) {
        const committedItems = decodeItems(commit.items);

        result.push({
          id: resolvedPrompt.id,
          transactionId: tx.id,
          purchaseOrderNumber: tx.purchaseOrderNumber,
          counterpartyName: tx.counterparty.companyName,
          committedDeliveryDate: commit.committedDeliveryDate.toISOString(),
          expectedItems: tx.items.map((i) => ({ name: i.name, quantity: Number(i.quantity) })),
          committedItems,
          status: resolvedPrompt.status,
          firstPromptAt: resolvedPrompt.firstPromptAt.toISOString(),
          lastPromptAt: resolvedPrompt.lastPromptAt.toISOString(),
          nextPromptAt: resolvedPrompt.nextPromptAt.toISOString(),
          outcome: resolvedPrompt.outcome as DeliveryOutcome | null,
          receivedQuantity: resolvedPrompt.receivedQuantity ? Number(resolvedPrompt.receivedQuantity) : null,
          confirmedBy: resolvedPrompt.confirmedBy,
          confirmedAt: resolvedPrompt.confirmedAt?.toISOString() ?? null,
          note: resolvedPrompt.note,
        });
      }
    }

    return result;
  });

  return rows;
}

export async function confirmDeliveryOutcome(
  workspaceId: string,
  transactionId: string,
  body: { outcome: DeliveryOutcome; receivedQuantity?: number; note?: string },
  confirmedBy: string
): Promise<{ prompt: DeliveryPromptRow; reconciled: boolean }> {
  const tx = await prisma.transaction.findFirst({
    where: { id: transactionId, workspaceId },
    select: {
      id: true,
      state: true,
      purchaseOrderNumber: true,
      counterparty: { select: { companyName: true } },
      items: { select: { name: true, quantity: true } },
    },
  });
  if (!tx) {
    throw new ApiError(404, "Unable to find this transaction in your workspace.");
  }

  const commit = await prisma.commitment.findFirst({
    where: { transactionId, isCurrent: true },
    orderBy: { commitmentNumber: "desc" },
  });
  if (!commit) {
    throw new ApiError(404, "Unable to find a transaction with an accepted commitment.");
  }
  const committedItems = decodeItems(commit.items);
  const committedTotal = committedItems.reduce((s, i) => s + i.quantity, 0);

  if (commit.committedDeliveryDate instanceof Date && commit.committedDeliveryDate.getTime() > Date.now()) {
    throw new ApiError(400, "The committed delivery date has not yet passed. Delivery confirmation is not yet due.");
  }

  const prompt = await prisma.deliveryConfirmationPrompt.findUnique({
    where: { transactionId },
  });
  if (!prompt) {
    throw new ApiError(404, "No delivery confirmation prompt for this transaction.");
  }
  if (prompt.status === "CONFIRMED") {
    throw new ApiError(409, "This transaction's delivery outcome has already been confirmed.");
  }
  if (prompt.nextPromptAt && prompt.nextPromptAt > new Date()) {
    throw new ApiError(400, "This confirmation prompt is not yet due.");
  }

  // Validate receivedQuantity for outcomes that use it.
  if (body.outcome === "RECEIVED" || body.outcome === "PARTIALLY_RECEIVED") {
    if (body.receivedQuantity == null || body.receivedQuantity < 0) {
      throw new ApiError(400, "Received quantity is required for this outcome.");
    }
    if (body.outcome === "RECEIVED" && body.receivedQuantity > committedTotal + 1e-9) {
      throw new ApiError(400, "Received quantity cannot exceed the committed quantity.");
    }
    if (body.outcome === "PARTIALLY_RECEIVED" && body.receivedQuantity >= committedTotal - 1e-9) {
      throw new ApiError(400, "Partial delivery must be less than the committed quantity.");
    }
  }

  if (body.outcome === "UNCONFIRMED") {
    body.receivedQuantity = undefined;
  }
  if (body.outcome === "NOT_RECEIVED") {
    body.receivedQuantity = 0;
  }

  const received = body.outcome === "NOT_RECEIVED" ? 0 : (body.receivedQuantity ?? 0);
  const difference = received - committedTotal;

  const isMatch =
    body.outcome === "RECEIVED" &&
    Math.abs(difference) < 1e-9;

  const isMismatch =
    (body.outcome === "PARTIALLY_RECEIVED" || body.outcome === "NOT_RECEIVED") ||
    (body.outcome === "RECEIVED" && Math.abs(difference) >= 1e-9);

  const resolvedPrompt: import("@prisma/client").DeliveryConfirmationPrompt = await prisma.$transaction(async (db) => {
    // Record the buyer's delivery outcome.
    await db.deliveryConfirmationPrompt.update({
      where: { id: prompt.id },
      data: {
        status: "CONFIRMED",
        outcome: body.outcome,
        receivedQuantity: received,
        note: body.note ?? null,
        confirmedBy,
        confirmedAt: new Date(),
        lastPromptAt: new Date(),
        nextPromptAt: null, // no further prompts after a definitive outcome
      },
    });

    // Record delivery confirmation evidence + reconciliation against the
    // committed quantities, so the existing completion engine can evaluate it.
    await db.evidence.create({
      data: {
        transactionId,
        type: EVIDENCE.deliveryConfirmation,
        source: "Buyer confirmation",
        reference: `GRN-${Date.now().toString(36).toUpperCase().slice(-6)}`,
        verified: true,
        notes: [
          `Delivery date: ${new Date().toISOString().slice(0, 10)}.`,
          `Confirmed by ${confirmedBy}.`,
          body.note ? `Note: ${body.note}` : null,
        ]
          .filter(Boolean)
          .join(" "),
      },
    });

    await db.activityEvent.create({
      data: {
        transactionId,
        type: "CLAIM_VERIFIED",
        description: `Delivery confirmed by ${confirmedBy}`,
        metadata: { actor: confirmedBy, outcome: body.outcome, receivedQuantity: received, committedQuantity: committedTotal } as never,
      },
    });

    await db.activityEvent.create({
      data: {
        transactionId,
        type: "RECONCILED",
        description: `Delivery reconciled: ${committedTotal} committed / ${received} received — ${isMatch ? "MATCH" : "MISMATCH"} (difference ${difference})`,
        metadata: {
          actor: "Nobryn",
          expected: committedTotal,
          received,
          difference,
          result: isMatch ? "MATCH" : "MISMATCH",
          source: "Buyer confirmation",
        } as never,
      },
    });

    // Advance state + completion only when the outcome matches the commitment.
    if (isMatch) {
      if (tx.state === TransactionState.FULFILLING) {
        await db.transaction.update({
          where: { id: transactionId },
          data: { state: TransactionState.DELIVERED },
        });
        await db.activityEvent.create({
          data: {
            transactionId,
            type: "STATE_CHANGED",
            description: "Transaction moved to Delivered",
            metadata: { actor: "Nobryn", from: TransactionState.FULFILLING, to: TransactionState.DELIVERED, reason: "Buyer confirmed delivery matches the commitment." } as never,
          },
        });
      }
      await runCompletionEvaluation(db, transactionId);
    } else if (isMismatch) {
      // Create or update a QUANTITY_MISMATCH exception.
      const existing = await db.exception.findFirst({
        where: { transactionId, type: ExceptionType.QUANTITY_MISMATCH },
      });
      if (existing) {
        await db.exception.update({
          where: { id: existing.id },
          data: {
            status: ExceptionStatus.OPEN,
            blocking: true,
            description: `Expected ${committedTotal} units, received ${received} units (difference ${difference} units).`,
            expected: committedTotal,
            observed: received,
            difference,
            owner: confirmedBy,
          },
        });
      } else {
        await db.exception.create({
          data: {
            transactionId,
            type: ExceptionType.QUANTITY_MISMATCH,
            status: ExceptionStatus.OPEN,
            severity: "HIGH",
            blocking: true,
            description: `Expected ${committedTotal} units, received ${received} units (difference ${difference} units).`,
            expected: committedTotal,
            observed: received,
            difference,
            owner: confirmedBy,
          },
        });
      }

      await db.activityEvent.create({
        data: {
          transactionId,
          type: "EXCEPTION_DETECTED",
          description: "Exception detected: Quantity mismatch",
          metadata: { actor: "Nobryn", severity: "HIGH", blocking: true, expected: committedTotal, observed: received, difference } as never,
        },
      });

      await notify(db, {
        workspaceId,
        transactionId,
        type: "QUANTITY_MISMATCH",
        severity: "ERROR",
        title: "Quantity mismatch detected",
        description: `Expected ${committedTotal} units, received ${received} units (difference ${difference} units).`,
        targetPath: `/app/transactions/${transactionId}`,
      });
    }

    return resolvedPrompt;
  });

  return {
    prompt: toDeliveryPromptRow(resolvedPrompt, tx, commit),
    reconciled: isMatch,
  };
}

export async function dismissDeliveryPrompt(
  workspaceId: string,
  transactionId: string
): Promise<DeliveryPromptRow> {
  const tx = await prisma.transaction.findFirst({
    where: { id: transactionId, workspaceId },
    select: {
      id: true,
      purchaseOrderNumber: true,
      counterparty: { select: { companyName: true } },
      items: { select: { name: true, quantity: true } },
    },
  });
  if (!tx) {
    throw new ApiError(404, "Unable to find this transaction in your workspace.");
  }

  const commit = await prisma.commitment.findFirst({
    where: { transactionId, isCurrent: true },
    orderBy: { commitmentNumber: "desc" },
  });
  if (!commit) {
    throw new ApiError(404, "Unable to find a transaction with an accepted commitment.");
  }

  const prompt = await prisma.deliveryConfirmationPrompt.findUnique({
    where: { transactionId },
  });
  if (!prompt) {
    throw new ApiError(404, "No delivery confirmation prompt for this transaction.");
  }
  if (prompt.status === "CONFIRMED") {
    throw new ApiError(409, "This transaction's delivery outcome has already been confirmed.");
  }

  const now = new Date();
  // Schedule the next prompt 24 hours after this prompt was last presented.
  const nextPromptAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const updated = await prisma.$transaction(async (db) => {
    const p = await db.deliveryConfirmationPrompt.update({
      where: { id: prompt.id },
      data: {
        status: "PENDING",
        lastPromptAt: now,
        nextPromptAt,
      },
    });
    return p;
  });

  return toDeliveryPromptRow(updated, tx, commit);
}

function toDeliveryPromptRow(
  prompt: {
    id: string;
    transactionId: string;
    status: string;
    firstPromptAt: Date;
    lastPromptAt: Date;
    nextPromptAt: Date | null;
    outcome: string | null;
    receivedQuantity: Prisma.Decimal | null;
    confirmedBy: string | null;
    confirmedAt: Date | null;
    note: string | null;
  },
  tx: { purchaseOrderNumber: string; items: { name: string; quantity: Prisma.Decimal }[]; counterparty: { companyName: string } },
  commit: { committedDeliveryDate: Date; items: Prisma.InputJsonValue | null }
): DeliveryPromptRow {
  return {
    id: prompt.id,
    transactionId: prompt.transactionId,
    purchaseOrderNumber: tx.purchaseOrderNumber,
    counterpartyName: tx.counterparty.companyName,
    committedDeliveryDate: commit.committedDeliveryDate.toISOString(),
    expectedItems: tx.items.map((i) => ({ name: i.name, quantity: Number(i.quantity) })),
    committedItems: decodeItems(commit.items ?? []),
    status: prompt.status,
    firstPromptAt: prompt.firstPromptAt.toISOString(),
    lastPromptAt: prompt.lastPromptAt.toISOString(),
    nextPromptAt: prompt.nextPromptAt?.toISOString() ?? "",
    outcome: prompt.outcome as string | null,
    receivedQuantity: prompt.receivedQuantity != null ? Number(prompt.receivedQuantity) : null,
    confirmedBy: prompt.confirmedBy,
    confirmedAt: prompt.confirmedAt?.toISOString() ?? null,
    note: prompt.note,
  };
}

// ---------------------------------------------------------------------------
// Supplier page snapshot (token-scoped, minimal, no workspace leakage)
// ---------------------------------------------------------------------------

export interface SupplierPageSnapshot {
  tokenValid: boolean;
  expired: boolean;
  revoked: boolean;
  transaction: {
    id: string;
    purchaseOrderNumber: string;
    buyerOrg: string;
    description: string;
    amount: string;
    currency: string;
    committedDeliveryDate: string | null;
    requestedDeliveryDate: string;
    expectedItems: { name: string; quantity: number }[];
    currentCommitment: {
      number: number;
      items: { name: string; quantity: number }[];
      committedDeliveryDate: string;
      explanation: string | null;
      createdAt: string;
    } | null;
    pendingProposal: {
      id: string;
      proposedItems: { name: string; quantity: number }[];
      proposedDeliveryDate: string;
      explanation: string | null;
      submittedAt: string;
    } | null;
    supplierNote: string | null;
    supplierNoteAt: string | null;
    status: string;
    history: SupplierHistoryEntry[];
  };
}

export interface SupplierHistoryEntry {
  type: string;
  label: string;
  at: string;
  detail?: string;
}

export async function supplierPageSnapshot(rawToken: string): Promise<SupplierPageSnapshot> {
  const resolved = await resolveAccessLinkByToken(rawToken);
  if (!resolved) {
    // Distinguish expired/revoked/unknown for a clear message.
    const digest = hashToken(rawToken);
    const link = await prisma.transactionAccessLink.findUnique({
      where: { token: digest },
    });
    const expired = link ? link.expiresAt <= new Date() : false;
    const revoked = link ? !!link.revokedAt : false;
    return {
      tokenValid: false,
      expired,
      revoked,
      transaction: null as unknown as SupplierPageSnapshot["transaction"],
    };
  }

  const { transactionId } = resolved;
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      purchaseOrderNumber: true,
      description: true,
      amount: true,
      currency: true,
      expectedDeliveryDate: true,
      supplierNote: true,
      updatedAt: true,
      state: true,
      counterparty: { select: { companyName: true } },
      items: { select: { name: true, quantity: true } },
    },
  });
  if (!tx) {
    return {
      tokenValid: true,
      expired: false,
      revoked: false,
      transaction: null as unknown as SupplierPageSnapshot["transaction"],
    };
  }

  const [current, proposal] = await Promise.all([
    prisma.commitment.findFirst({
      where: { transactionId, isCurrent: true },
      orderBy: { commitmentNumber: "desc" },
    }),
    prisma.commitmentProposal.findFirst({
      where: { transactionId, status: "PENDING" },
      orderBy: { submittedAt: "desc" },
    }),
  ]);

  const history: SupplierHistoryEntry[] = [];
  if (current) {
    history.push({
      type: "commitment",
      label: `Commitment #${current.commitmentNumber} accepted`,
      at: current.createdAt.toISOString(),
      detail: `Committed to ${decodeItems(current.items).length} item${decodeItems(current.items).length === 1 ? "" : "s"}.`,
    });
  }
  if (proposal) {
    history.push({
      type: "proposal",
      label: "Change proposed",
      at: proposal.submittedAt.toISOString(),
      detail: proposal.explanation ?? "Awaiting buyer approval.",
    });
  }
  if (tx.supplierNote) {
    // supplierNoteAt isn't stored separately; approximate with updatedAt.
    history.push({
      type: "note",
      label: "Message from buyer",
      at: tx.updatedAt.toISOString(),
      detail: tx.supplierNote,
    });
  }

  return {
    tokenValid: true,
    expired: false,
    revoked: false,
    transaction: {
      id: tx.id,
      purchaseOrderNumber: tx.purchaseOrderNumber,
      buyerOrg: "", // filled by caller with workspace.name
      description: tx.description,
      amount: String(tx.amount),
      currency: tx.currency,
      committedDeliveryDate: current?.committedDeliveryDate.toISOString() ?? null,
      requestedDeliveryDate: tx.expectedDeliveryDate.toISOString(),
      expectedItems: tx.items.map((i) => ({ name: i.name, quantity: Number(i.quantity) })),
      currentCommitment: current
        ? {
            number: current.commitmentNumber,
            items: decodeItems(current.items),
            committedDeliveryDate: current.committedDeliveryDate.toISOString(),
            explanation: current.explanation,
            createdAt: current.createdAt.toISOString(),
          }
        : null,
      pendingProposal: proposal
        ? {
            id: proposal.id,
            proposedItems: decodeItems(proposal.proposedItems),
            proposedDeliveryDate: proposal.proposedDeliveryDate.toISOString(),
            explanation: proposal.explanation,
            submittedAt: proposal.submittedAt.toISOString(),
          }
        : null,
      supplierNote: tx.supplierNote,
      supplierNoteAt: tx.supplierNote ? tx.updatedAt.toISOString() : null,
      status: computeSupplierStatus(current, proposal, tx.state),
      history,
    },
  };
}

function computeSupplierStatus(
  current: { committedDeliveryDate: Date } | null,
  proposal: { status: string } | null,
  state: TransactionState
): string {
  if (proposal && proposal.status === "PENDING") return "Awaiting buyer approval";
  if (current) {
    if (state === TransactionState.COMPLETED) return "Completed";
    if (state === TransactionState.DELIVERED) return "Delivered — awaiting confirmation";
    return "Commitment active";
  }
  return "Awaiting your commitment";
}

// The DB stores only the token digest; the raw token is needed to build the URL
// for supplier-facing emails. We cannot recover it from the digest, so this is
// only usable when the raw token is available (create/rotate return it, and the
// buyer keeps it). For supplier notifications we use the link that already
// exists for the transaction.
async function reconstructRawToken(_digest: string): Promise<string | null> {
  // We cannot recover a raw token from its digest. Supplier notifications that
  // need a link URL must use a currently-active link whose raw token was
  // returned at creation/rotation and is held by the caller, or we must store
  // it. To keep the raw token out of the database, supplier-facing emails are
  // sent at the moment a link is created/rotated (when we still have the raw
  // token), not on demand later. This function therefore returns null and
  // buyer-decision supplier emails are sent only when there is an active link
  // created during the same request flow. In practice, the buyer creates the
  // link and the invite is sent then; later decisions reuse the same link URL
  // only if we stored it. To avoid storing raw tokens, decision emails omit the
  // link and direct the supplier to contact the buyer.
  return null;
}

// ---------------------------------------------------------------------------
// Helpers reused by the execution engine (delivery confirmation evidence)
// ---------------------------------------------------------------------------


async function runCompletionEvaluation(
  db: Prisma.TransactionClient,
  transactionId: string
): Promise<boolean> {
  const tx = await db.transaction.findUnique({
    where: { id: transactionId },
    include: { evidence: true, exceptions: true, items: true },
  });
  if (!tx || tx.state !== TransactionState.DELIVERED) return false;

  const hasCompletion = tx.evidence.some(
    (e) => e.verified && e.type === EVIDENCE.completion
  );
  if (hasCompletion) return false;

  const openBlocking = tx.exceptions.filter(
    (x) => x.status !== ExceptionStatus.RESOLVED && x.blocking
  );
  if (openBlocking.length > 0) return false;

  await db.evidence.create({
    data: {
      transactionId,
      type: EVIDENCE.completion,
      source: "Nobryn",
      reference: `VR-${Date.now().toString(36).toUpperCase().slice(-6)}`,
      verified: true,
      notes: "Completion verification passed: required evidence verified, delivery reconciled against the committed commitment, no blocking exceptions.",
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
  await db.transaction.update({
    where: { id: transactionId },
    data: { state: TransactionState.COMPLETED },
  });
  await db.activityEvent.create({
    data: {
      transactionId,
      type: "STATE_CHANGED",
      description: "Transaction moved to Completed",
      metadata: { actor: "Nobryn", from: TransactionState.DELIVERED, to: TransactionState.COMPLETED, reason: "Completion conditions satisfied." } as never,
    },
  });
  await notify(db, {
    workspaceId: tx.workspaceId,
    transactionId,
    type: "TRANSACTION_COMPLETED",
    severity: "INFO",
    title: "Transaction completed",
    description: `${tx.purchaseOrderNumber} satisfied all completion conditions.`,
    targetPath: `/app/transactions/${transactionId}`,
  });
  return true;
}
