import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

const DAY = 24 * 60 * 60 * 1000;

function at(daysAgo: number, hour: number, minute: number): Date {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function main() {
  const email = "demo@nobryn.test";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("[seed] Demo workspace already exists — skipping.");
    return;
  }

  const passwordHash = await bcrypt.hash("nobryn-demo-2026", 10);
  const owner = await prisma.user.create({
    data: {
      firstName: "Dana",
      lastName: "Reyes",
      email,
      passwordHash,
    },
  });

  const workspace = await prisma.workspace.create({
    data: { name: "Acme Corporation", ownerId: owner.id },
  });

  const [globalComponents, northSupply, acmeLogistics] = await Promise.all([
    prisma.counterparty.create({
      data: {
        workspaceId: workspace.id,
        companyName: "Global Components",
        contactName: "Maren Keller",
        email: "maren.keller@globalcomponents.example",
      },
    }),
    prisma.counterparty.create({
      data: {
        workspaceId: workspace.id,
        companyName: "North Supply",
        contactName: "Ibrahim Diallo",
        email: "i.diallo@northsupply.example",
      },
    }),
    prisma.counterparty.create({
      data: {
        workspaceId: workspace.id,
        companyName: "Acme Logistics",
        contactName: "Sofia Brandt",
        email: "s.brandt@acmelogistics.example",
      },
    }),
  ]);

  // -------------------------------------------------------------------------
  // PO-10481 — Acme Logistics — COMPLETED (full successful lifecycle)
  // -------------------------------------------------------------------------
  const po10481 = await prisma.transaction.create({
    data: {
      workspaceId: workspace.id,
      purchaseOrderNumber: "PO-10481",
      counterpartyId: acmeLogistics.id,
      description: "Palletized packaging materials for distribution centers",
      amount: 72200,
      currency: "USD",
      expectedDeliveryDate: at(4, 12, 0),
      state: "COMPLETED",
      items: {
        create: [
          { name: "Industrial pallet wrapping (roll)", quantity: 4000, unitPrice: 12.5, total: 50000 },
          { name: "Reinforced strapping kit", quantity: 740, unitPrice: 30, total: 22200 },
        ],
      },
    },
  });
  await prisma.evidence.createMany({
    data: [
      {
        transactionId: po10481.id,
        type: "Supplier confirmation",
        source: "Supplier API",
        reference: "Confirmation #491204",
        receivedAt: at(10, 9, 5),
        verified: true,
      },
      {
        transactionId: po10481.id,
        type: "Fulfillment started",
        source: "Supplier API",
        reference: "Fulfillment order #77124",
        receivedAt: at(9, 14, 30),
        verified: true,
      },
      {
        transactionId: po10481.id,
        type: "Delivery confirmation",
        source: "Warehouse system",
        reference: "GRN-88110",
        receivedAt: at(4, 13, 45),
        verified: true,
      },
      {
        transactionId: po10481.id,
        type: "Completion verification",
        source: "Nobryn",
        reference: "VR-302911",
        receivedAt: at(4, 16, 5),
        verified: true,
      },
    ],
  });
  await prisma.activityEvent.createMany({
    data: [
      { transactionId: po10481.id, type: "TRANSACTION_CREATED", description: "Transaction created", createdAt: at(11, 8, 20) },
      { transactionId: po10481.id, type: "SUPPLIER_CONFIRMED", description: "Supplier confirmation received", createdAt: at(10, 9, 5) },
      { transactionId: po10481.id, type: "STATE_CHANGED", description: "Transaction moved to Accepted", createdAt: at(10, 9, 6) },
      { transactionId: po10481.id, type: "FULFILLMENT_STARTED", description: "Fulfillment started", createdAt: at(9, 14, 30) },
      { transactionId: po10481.id, type: "STATE_CHANGED", description: "Transaction moved to Fulfilling", createdAt: at(9, 14, 31) },
      { transactionId: po10481.id, type: "DELIVERY_CONFIRMED", description: "Delivery confirmed", createdAt: at(4, 13, 45) },
      { transactionId: po10481.id, type: "STATE_CHANGED", description: "Transaction moved to Delivered", createdAt: at(4, 13, 46) },
      { transactionId: po10481.id, type: "COMPLETION_VERIFIED", description: "Completion verified", createdAt: at(4, 16, 5) },
      { transactionId: po10481.id, type: "STATE_CHANGED", description: "Transaction moved to Completed", createdAt: at(4, 16, 6) },
    ],
  });

  // -------------------------------------------------------------------------
  // PO-10480 — North Supply — FULFILLING with an OPEN quantity mismatch
  // -------------------------------------------------------------------------
  const po10480 = await prisma.transaction.create({
    data: {
      workspaceId: workspace.id,
      purchaseOrderNumber: "PO-10480",
      counterpartyId: northSupply.id,
      description: "Precision bearings for production line 4",
      amount: 31900,
      currency: "USD",
      expectedDeliveryDate: at(1, 17, 0),
      state: "FULFILLING",
      items: {
        create: [
          { name: "Sealed spherical bearing", quantity: 500, unitPrice: 60, total: 30000 },
          { name: "Mounting adapter set", quantity: 100, unitPrice: 19, total: 1900 },
        ],
      },
    },
  });
  await prisma.evidence.createMany({
    data: [
      {
        transactionId: po10480.id,
        type: "Supplier confirmation",
        source: "Supplier API",
        reference: "Confirmation #489933",
        receivedAt: at(3, 10, 12),
        verified: true,
      },
      {
        transactionId: po10480.id,
        type: "Fulfillment started",
        source: "Supplier API",
        reference: "Fulfillment order #76845",
        receivedAt: at(3, 11, 0),
        verified: true,
      },
    ],
  });
  await prisma.exception.create({
    data: {
      transactionId: po10480.id,
      type: "QUANTITY_MISMATCH",
      status: "OPEN",
      description: "The received quantity does not match the ordered quantity.",
      detectedAt: at(1, 11, 14),
      nextAction: "Supplier confirmation required",
    },
  });
  await prisma.activityEvent.createMany({
    data: [
      { transactionId: po10480.id, type: "TRANSACTION_CREATED", description: "Transaction created", createdAt: at(3, 9, 41) },
      { transactionId: po10480.id, type: "SUPPLIER_CONFIRMED", description: "Supplier confirmation received", createdAt: at(3, 10, 12) },
      { transactionId: po10480.id, type: "STATE_CHANGED", description: "Transaction moved to Accepted", createdAt: at(3, 10, 13) },
      { transactionId: po10480.id, type: "FULFILLMENT_STARTED", description: "Fulfillment started", createdAt: at(3, 11, 0) },
      { transactionId: po10480.id, type: "STATE_CHANGED", description: "Transaction moved to Fulfilling", createdAt: at(3, 11, 1) },
      { transactionId: po10480.id, type: "EXCEPTION_DETECTED", description: "Exception detected: Quantity mismatch", createdAt: at(1, 11, 14) },
    ],
  });

  // -------------------------------------------------------------------------
  // PO-10482 — Global Components — FULFILLING (active showcase transaction)
  // -------------------------------------------------------------------------
  const po10482 = await prisma.transaction.create({
    data: {
      workspaceId: workspace.id,
      purchaseOrderNumber: "PO-10482",
      counterpartyId: globalComponents.id,
      description: "Industrial components for warehouse inventory",
      amount: 184500,
      currency: "USD",
      expectedDeliveryDate: at(-1, 17, 0), // tomorrow
      state: "FULFILLING",
      items: {
        create: [
          { name: "Precision drive assembly", quantity: 500, unitPrice: 350, total: 175000 },
          { name: "Control module", quantity: 95, unitPrice: 100, total: 9500 },
        ],
      },
    },
  });
  await prisma.evidence.createMany({
    data: [
      {
        transactionId: po10482.id,
        type: "Supplier confirmation",
        source: "Supplier API",
        reference: "Confirmation #483921",
        receivedAt: at(1, 10, 43),
        verified: true,
      },
      {
        transactionId: po10482.id,
        type: "Fulfillment started",
        source: "Supplier API",
        reference: "Fulfillment order #76452",
        receivedAt: at(1, 10, 44),
        verified: true,
      },
    ],
  });
  await prisma.activityEvent.createMany({
    data: [
      { transactionId: po10482.id, type: "TRANSACTION_CREATED", description: "Transaction created", createdAt: at(1, 9, 41) },
      { transactionId: po10482.id, type: "SUPPLIER_CONFIRMED", description: "Supplier confirmation received", createdAt: at(1, 10, 43) },
      { transactionId: po10482.id, type: "STATE_CHANGED", description: "Transaction moved to Accepted", createdAt: at(1, 10, 44) },
      { transactionId: po10482.id, type: "FULFILLMENT_STARTED", description: "Fulfillment started", createdAt: at(1, 10, 45) },
      { transactionId: po10482.id, type: "STATE_CHANGED", description: "Transaction moved to Fulfilling", createdAt: at(1, 10, 46) },
    ],
  });

  console.log("[seed] Demo workspace created:");
  console.log("  Workspace: Acme Corporation");
  console.log("  Login:     demo@nobryn.test / nobryn-demo-2026");
}

main()
  .catch((err) => {
    console.error("[seed] Failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
