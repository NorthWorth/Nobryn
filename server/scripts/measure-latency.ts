/**
 * Latency measurement for the important read endpoints.
 *
 * Boots the real API in-process (same as the E2E suite), signs a session for
 * an existing account and measures:
 *
 *   1. end-to-end HTTP time per endpoint (client → Express → Prisma → Aiven)
 *   2. database round-trip time for the same window
 *   3. the previous (pre-optimization) query shapes against the current data,
 *      so before/after query cost can be compared on the same workspace
 *
 * Read-only: it never creates, updates or deletes application data.
 *
 *   bun run measure            (from server/)
 */
import { bootstrapEnvironment, startApi } from "../tests/helpers.js";

bootstrapEnvironment();
const { prisma } = await import("../prisma.js");
const { signToken } = await import("../auth.js");

const RUNS = 3;

function ms(value: number): string {
  return `${Math.round(value)}ms`;
}

async function measure(label: string, fn: () => Promise<unknown>): Promise<void> {
  // Warm-up run (JIT, connection pool, prepared statements).
  await fn();
  const totals: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now();
    await fn();
    totals.push(performance.now() - started);
  }
  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
  const min = Math.min(...totals);
  console.log(`  ${label.padEnd(46)} avg=${ms(avg).padStart(7)}  min=${ms(min).padStart(7)}`);
}

async function main(): Promise<void> {
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) {
    console.log("No account in this database — nothing to measure.");
    return;
  }
  const workspace = await prisma.workspace.findFirst({
    where: { ownerId: user.id },
    orderBy: { createdAt: "asc" },
  });
  if (!workspace) {
    console.log("No workspace in this database — nothing to measure.");
    return;
  }

  const base = await startApi();
  const token = signToken({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  });
  const headers = { Authorization: `Bearer ${token}` };

  const firstTx = await prisma.transaction.findFirst({
    where: { workspaceId: workspace.id },
    orderBy: { updatedAt: "desc" },
  });

  console.log("\nHTTP end-to-end (server in this sandbox → Aiven PostgreSQL)");
  await measure("GET /health (public, no DB)", async () => {
    await fetch(`${base}/health`);
  });
  await measure("GET /health/deep (public, 1 round trip)", async () => {
    await fetch(`${base}/health/deep`);
  });
  await measure("GET /api/overview (page-level)", async () => {
    await fetch(`${base}/api/overview`, { headers });
  });
  await measure("GET /api/summary (legacy)", async () => {
    await fetch(`${base}/api/summary`, { headers });
  });
  await measure("GET /api/transactions", async () => {
    await fetch(`${base}/api/transactions`, { headers });
  });
  await measure("GET /api/counterparties", async () => {
    await fetch(`${base}/api/counterparties`, { headers });
  });
  await measure("GET /api/exceptions", async () => {
    await fetch(`${base}/api/exceptions`, { headers });
  });
  await measure("GET /api/notifications", async () => {
    await fetch(`${base}/api/notifications`, { headers });
  });
  if (firstTx) {
    await measure("GET /api/transactions/:id (detail)", async () => {
      await fetch(`${base}/api/transactions/${firstTx.id}`, { headers });
    });
  }
  await measure("GET /api/observability (dashboard)", async () => {
    await fetch(`${base}/api/observability`, { headers });
  });

  console.log("\nDatabase round trip");
  await measure("SELECT 1 (connection RTT)", async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  console.log("\nQuery shapes: previous vs optimized (same workspace)");
  await measure("transactions list — include counterparty (before)", async () => {
    await prisma.transaction.findMany({
      where: { workspaceId: workspace.id },
      include: { counterparty: true },
      orderBy: { updatedAt: "desc" },
    });
  });
  await measure("transactions list — select projection (after)", async () => {
    await prisma.transaction.findMany({
      where: { workspaceId: workspace.id },
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
  });
  await measure("counterparties — full tx rows per cp (before)", async () => {
    await prisma.counterparty.findMany({
      where: { workspaceId: workspace.id },
      include: { transactions: { select: { updatedAt: true } } },
      orderBy: { companyName: "asc" },
    });
  });
  await measure("counterparties — count + groupBy max (after)", async () => {
    await Promise.all([
      prisma.counterparty.findMany({
        where: { workspaceId: workspace.id },
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
        where: { workspaceId: workspace.id },
        _max: { updatedAt: true },
      }),
    ]);
  });
  await measure("action required — all relations (before)", async () => {
    await prisma.transaction.findMany({
      where: { workspaceId: workspace.id },
      include: { evidence: true, exceptions: true, policy: true, activity: true },
    });
  });
  const { deriveActionRequired } = await import("../services/actionRequired.js");
  await measure("action required — projected + prefilter (after)", async () => {
    await deriveActionRequired(workspace.id);
  });

  console.log("\nOriginal implementation reproduced on the same data (before)");
  await measure("auth: user + workspace sequential (before)", async () => {
    await prisma.user.findUnique({ where: { id: user.id } });
    await prisma.workspace.findFirst({
      where: { ownerId: user.id },
      orderBy: { createdAt: "asc" },
    });
  });
  await measure("action required: all relations + rejected seq. (before)", async () => {
    await prisma.transaction.findMany({
      where: { workspaceId: workspace.id },
      include: { evidence: true, exceptions: true, policy: true, activity: true },
    });
    await prisma.integrationEvent.findMany({
      where: { workspaceId: workspace.id, status: "REJECTED" },
      include: { transaction: { select: { purchaseOrderNumber: true } } },
      orderBy: { receivedAt: "desc" },
      take: 10,
    });
  });
  await measure("GET /api/summary (before: auth + 6 + actionRequired)", async () => {
    await prisma.user.findUnique({ where: { id: user.id } });
    await prisma.workspace.findFirst({
      where: { ownerId: user.id },
      orderBy: { createdAt: "asc" },
    });
    const [a, b, c, d, recent, openList] = await Promise.all([
      prisma.transaction.count({ where: { workspaceId: workspace.id, state: { not: "COMPLETED" as never } } }),
      prisma.exception.count({ where: { transaction: { workspaceId: workspace.id }, status: { not: "RESOLVED" as never } } }),
      prisma.transaction.count({ where: { workspaceId: workspace.id, state: "COMPLETED" as never } }),
      prisma.counterparty.count({ where: { workspaceId: workspace.id } }),
      prisma.transaction.findMany({
        where: { workspaceId: workspace.id },
        include: { counterparty: true },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
      prisma.exception.findMany({
        where: { transaction: { workspaceId: workspace.id }, status: { not: "RESOLVED" as never } },
        include: { transaction: { select: { id: true, purchaseOrderNumber: true } } },
        orderBy: { detectedAt: "desc" },
        take: 5,
      }),
    ]);
    void [a, b, c, d, recent, openList];
    await prisma.transaction.findMany({
      where: { workspaceId: workspace.id },
      include: { evidence: true, exceptions: true, policy: true, activity: true },
    });
    await prisma.integrationEvent.findMany({
      where: { workspaceId: workspace.id, status: "REJECTED" },
      include: { transaction: { select: { purchaseOrderNumber: true } } },
      orderBy: { receivedAt: "desc" },
      take: 10,
    });
  });
  await measure("Overview page (before: summary + full tx list)", async () => {
    await prisma.user.findUnique({ where: { id: user.id } });
    await prisma.workspace.findFirst({
      where: { ownerId: user.id },
      orderBy: { createdAt: "asc" },
    });
    await Promise.all([
      prisma.transaction.count({ where: { workspaceId: workspace.id } }),
      prisma.exception.count({ where: { transaction: { workspaceId: workspace.id } } }),
      prisma.transaction.findMany({
        where: { workspaceId: workspace.id },
        include: { counterparty: true },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
    ]);
    await prisma.transaction.findMany({
      where: { workspaceId: workspace.id },
      include: { evidence: true, exceptions: true, policy: true, activity: true },
    });
    // Second request the old Overview page fired for its activity feed.
    await prisma.transaction.findMany({
      where: { workspaceId: workspace.id },
      include: { counterparty: true },
      orderBy: { updatedAt: "desc" },
    });
  });

  await prisma.$disconnect();
  // The in-process API keeps the event loop alive; this script is a one-shot
  // measurement, so exit explicitly once the numbers are printed.
  process.exit(0);
}

await main();
