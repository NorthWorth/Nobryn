/**
 * Nobryn end-to-end suite — exercises the real HTTP API against the real
 * database, covering the required behaviors:
 *
 *  1 successful delivery verification   14 quantity tolerance
 *  2 successful reconciliation          15 blocking vs non-blocking exceptions
 *  3 successful completion              16 action-required generation
 *  4 quantity mismatch                  17 action-required removal
 *  5 automatic exception creation       18 notification creation
 *  6 blocking completion                19 notification read state
 *  7 exception resolution               20 event provenance
 *  8 reconciliation after resolution    21 activity/audit events
 *  9 duplicate event suppression        22 workspace authorization
 * 10 invalid event rejection            23 refresh persistence
 * 11 invalid state transition rejection 24 simulator success flow
 * 12 verification-required policy       25 simulator mismatch flow
 * 13 verification-not-required policy
 */
import { bootstrapEnvironment, startApi, makeClient, check, finish, TODAY, IN_DAYS, YESTERDAY } from "./helpers.js";

bootstrapEnvironment();
const { prisma } = await import("../prisma.js");

// Clean up artifacts from any previous (possibly crashed) test run.
async function cleanup() {
  await prisma.workspace.deleteMany({
    where: { owner: { email: { endsWith: "@nobryn.test" } } },
  });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@nobryn.test" } } });
}
await cleanup();

const base = await startApi();
const req = makeClient(base);

const ev = (tx: any, type: string) => tx.evidence.filter((e: any) => e.type === type);
const acts = (tx: any, type: string) => tx.activity.filter((a: any) => a.type === type);

async function actionItems(token: string): Promise<any[]> {
  const r = await req("GET", "/api/summary", undefined, token);
  return r.json.actionRequired ?? [];
}
async function notifications(token: string) {
  const r = await req("GET", "/api/notifications", undefined, token);
  return r.json as { notifications: any[]; unreadCount: number };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const stamp = Date.now();
const reg = await req("POST", "/api/auth/register", {
  firstName: "E2E",
  lastName: "Tester",
  email: `e2e-${stamp}@nobryn.test`,
  password: "password123",
  workspaceName: "E2E Workspace",
});
check("setup: register", reg.status === 201 && !!reg.json.token, reg.status);
const token = reg.json.token as string;

const cp = await req(
  "POST",
  "/api/counterparties",
  { companyName: "Acme Components", contactName: "Jo Doe", email: "jo@acme.test" },
  token
);
const counterpartyId: string = cp.json.counterparty?.id;
check("setup: counterparty", cp.status === 201 && !!counterpartyId, cp.status);

async function createTx(po: string, qty: number, delivery: string, policyId?: string) {
  const r = await req(
    "POST",
    "/api/transactions",
    {
      purchaseOrderNumber: po,
      counterpartyId,
      description: "E2E verification order",
      amount: qty * 10,
      currency: "USD",
      expectedDeliveryDate: delivery,
      ...(policyId ? { policyId } : {}),
      items: [{ name: "Widget", quantity: qty, unitPrice: 10 }],
    },
    token
  );
  check(`setup: create ${po}`, r.status === 201 && !!r.json.transaction?.id, r.status);
  return r.json.transaction;
}

const event = (txId: string, body: unknown) =>
  req("POST", `/api/transactions/${txId}/events`, body, token);
const getTx = async (txId: string) =>
  (await req("GET", `/api/transactions/${txId}`, undefined, token)).json.transaction;
const verify = (txId: string, body: unknown) =>
  req("POST", `/api/transactions/${txId}/verify`, body, token);

// ===========================================================================
// Policies (validation + persistence)
// ===========================================================================
console.log("--- policies ---");
const polRes = await req("GET", "/api/policies", undefined, token);
const defaultPolicy = (polRes.json.policies ?? []).find(
  (p: any) => p.name === "Standard purchase order"
);
check("default policy persisted", polRes.status === 200 && !!defaultPolicy, polRes.status);
check(
  "policy defines completion condition",
  typeof defaultPolicy?.completionCondition === "string" &&
    defaultPolicy.completionCondition.includes("no blocking exceptions"),
  defaultPolicy?.completionCondition
);

const badPolicy = await req(
  "POST",
  "/api/policies",
  {
    name: "",
    deliveryConfirmationRequired: true,
    quantityReconciliationRequired: true,
    quantityTolerance: -5,
    confirmationWindowHours: 0,
    blockingMismatches: true,
  },
  token
);
check("invalid policy payload rejected (400)", badPolicy.status === 400, badPolicy.status);

async function createPolicy(payload: Record<string, unknown>) {
  const r = await req("POST", "/api/policies", payload, token);
  check(`policy created: ${payload.name}`, r.status === 201 && !!r.json.policy?.id, r.status);
  return r.json.policy;
}
const pTol = await createPolicy({
  name: "Tolerance policy",
  deliveryConfirmationRequired: true,
  quantityReconciliationRequired: true,
  quantityTolerance: 40,
  confirmationWindowHours: 24,
  blockingMismatches: true,
});
const pNoVerify = await createPolicy({
  name: "Trusted delivery policy",
  deliveryConfirmationRequired: false,
  quantityReconciliationRequired: true,
  quantityTolerance: 0,
  confirmationWindowHours: 24,
  blockingMismatches: true,
});
const pNonBlock = await createPolicy({
  name: "Non-blocking mismatch policy",
  deliveryConfirmationRequired: true,
  quantityReconciliationRequired: true,
  quantityTolerance: 0,
  confirmationWindowHours: 24,
  blockingMismatches: false,
});

// ===========================================================================
// Success path (also the simulator success flow): 500 -> MATCH -> COMPLETED
// ===========================================================================
console.log("--- success flow ---");
const s = await createTx("PO-E2E-SUCCESS", 500, IN_DAYS(7));
check("success: starts CREATED", s.state === "CREATED", s.state);
check(
  "success: transaction executes under persisted default policy",
  s.policy?.name === "Standard purchase order",
  s.policy?.name
);

const conf = await event(s.id, {
  type: "SUPPLIER_CONFIRMATION",
  source: "Supplier API",
  eventId: "s-conf-1",
});
check(
  "success: supplier confirmation -> ACCEPTED",
  conf.status === 201 && conf.json.transaction.state === "ACCEPTED",
  conf.status + "/" + conf.json.transaction?.state
);
check("event result CLAIM_CREATED", conf.json.result === "CLAIM_CREATED", conf.json.result);
check(
  "success: confirmation evidence verified",
  ev(conf.json.transaction, "Supplier confirmation").length === 1 &&
    ev(conf.json.transaction, "Supplier confirmation")[0].verified === true
);

let sDetail = await getTx(s.id);
const processedConf = (sDetail.events ?? []).find(
  (e: any) => e.eventId === "s-conf-1" && e.status === "PROCESSED"
);
check(
  "event provenance: PROCESSED row with source/type/timestamps/result",
  !!processedConf &&
    processedConf.source === "Supplier API" &&
    processedConf.type === "SUPPLIER_CONFIRMATION" &&
    !!processedConf.processedAt &&
    processedConf.result === "CLAIM_CREATED",
  processedConf
);

// Duplicate: same stable event id
const dupConf = await event(s.id, {
  type: "SUPPLIER_CONFIRMATION",
  source: "Supplier API",
  eventId: "s-conf-1",
});
check(
  "9. duplicate event id suppressed (no state change, no new evidence)",
  dupConf.status === 200 &&
    dupConf.json.duplicate === true &&
    ev(dupConf.json.transaction, "Supplier confirmation").length === 1,
  dupConf.status
);
sDetail = await getTx(s.id);
const dupRow = (sDetail.events ?? []).find(
  (e: any) => e.eventId === "s-conf-1" && e.status === "DUPLICATE"
);
check(
  "event provenance: DUPLICATE row result IGNORED",
  !!dupRow && dupRow.result === "IGNORED",
  dupRow
);

const ful = await event(s.id, { type: "FULFILLMENT_STARTED", source: "Supplier API" });
check(
  "success: fulfillment -> FULFILLING",
  ful.json.transaction.state === "FULFILLING",
  ful.json.transaction.state
);

const del = await event(s.id, {
  type: "DELIVERY_REPORTED",
  source: "Warehouse system",
  reportedQuantity: 500,
  eventId: "s-del-1",
});
const delTx = del.json.transaction;
check(
  "12. verification required: delivery claim does NOT advance state",
  delTx.state === "FULFILLING",
  delTx.state
);
check("claim recorded UNVERIFIED", ev(delTx, "Delivery reported")[0]?.verified === false);
check("no verified delivery evidence yet", ev(delTx, "Delivery confirmation").length === 0);
check(
  "claim surfaced for the verification UI",
  !!delTx.deliveryClaim && delTx.deliveryClaim.reportedQuantity === 500
);
check("awaitingVerification flag set", del.json.awaitingVerification === true);

const dupDel = await event(s.id, {
  type: "DELIVERY_REPORTED",
  source: "Warehouse system",
  reportedQuantity: 500,
  eventId: "s-del-2",
});
check(
  "duplicate claim suppressed (type-level)",
  dupDel.status === 200 &&
    dupDel.json.duplicate === true &&
    ev(dupDel.json.transaction, "Delivery reported").length === 1,
  dupDel.status
);

// Action required + notification generated from the pending claim
let summary = (await req("GET", "/api/summary", undefined, token)).json;
const verifyItem = (summary.actionRequired ?? []).find(
  (i: any) => i.id === `verify:${s.id}`
);
check(
  "action-required: verification item generated",
  !!verifyItem &&
    verifyItem.kind === "VERIFICATION" &&
    verifyItem.title.includes("confirmation required") &&
    verifyItem.targetPath === `/app/transactions/${s.id}`,
  verifyItem
);
let notif = await notifications(token);
check(
  "notification: VERIFICATION_REQUIRED created (unread)",
  notif.notifications.some(
    (n: any) => n.type === "VERIFICATION_REQUIRED" && n.transactionId === s.id && !n.readAt
  ),
  notif.unreadCount
);

// Audit trail: claim row with category + actor
sDetail = await getTx(s.id);
const claimRow = acts(sDetail, "CLAIM_RECEIVED").find((a: any) =>
  a.description.includes("Delivery reported by Warehouse system")
);
check(
  "audit: claim event has CLAIM category and source actor",
  !!claimRow && claimRow.category === "CLAIM" && claimRow.actor === "Warehouse system",
  claimRow
);

// Human verification
const verified = await verify(s.id, {
  receivedQuantity: 500,
  deliveryDate: TODAY(),
  note: "All 500 units received.",
});
check("verify: request accepted", verified.status === 200, verified.status);
const vt = verified.json.transaction;
check("1. delivery verified by human", ev(vt, "Delivery confirmation").length === 1 && ev(vt, "Delivery confirmation")[0].verified === true);
check("claim remains distinct from verification", ev(vt, "Delivery reported")[0].verified === false);
check(
  "2. reconciliation MATCH (500 vs 500, difference 0)",
  vt.reconciliations.at(-1)?.expected === 500 &&
    vt.reconciliations.at(-1)?.received === 500 &&
    vt.reconciliations.at(-1)?.difference === 0 &&
    vt.reconciliations.at(-1)?.result === "MATCH",
  vt.reconciliations.at(-1)
);
check("3. transaction COMPLETED", vt.state === "COMPLETED", vt.state);
check("completion evidence recorded", ev(vt, "Completion verification").length === 1);
check("no completion blockers", vt.completionBlocking.length === 0, vt.completionBlocking);

const categories = new Set(vt.activity.map((a: any) => a.category));
for (const category of ["CLAIM", "VERIFICATION", "RECONCILIATION", "STATE CHANGE", "COMPLETION"]) {
  check(`21. audit category present: ${category}`, categories.has(category));
}
const verifyRow = acts(vt, "CLAIM_VERIFIED")[0];
check(
  "21. verification actor is the confirming user",
  verifyRow?.actor === "E2E Tester",
  verifyRow?.actor
);
const stateRows = acts(vt, "STATE_CHANGED").map((a: any) => a.metadata);
check(
  "21. state changes carry from/to/reason metadata",
  stateRows.some((m: any) => m?.from === "FULFILLING" && m?.to === "DELIVERED") &&
    stateRows.some((m: any) => m?.from === "DELIVERED" && m?.to === "COMPLETED" && !!m?.reason),
  stateRows
);

// Action item disappears, claim cleared, notifications generated
summary = (await req("GET", "/api/summary", undefined, token)).json;
check(
  "17. action-required item removed after verification",
  !(summary.actionRequired ?? []).some((i: any) => i.id === `verify:${s.id}`)
);
sDetail = await getTx(s.id);
check("verification callout cleared (deliveryClaim null)", sDetail.deliveryClaim === null);
notif = await notifications(token);
check(
  "18. notifications: VERIFICATION_COMPLETED + TRANSACTION_COMPLETED",
  notif.notifications.some((n: any) => n.type === "VERIFICATION_COMPLETED") &&
    notif.notifications.some((n: any) => n.type === "TRANSACTION_COMPLETED")
);

// 23. refresh persistence
const reloaded = await getTx(s.id);
check(
  "23. refresh preserves state and evidence",
  reloaded.state === "COMPLETED" &&
    reloaded.evidence.length === vt.evidence.length &&
    reloaded.events.length === sDetail.events.length
);

// 24. simulator success flow evidence chain complete
const chain = ["Supplier confirmation", "Fulfillment started", "Delivery reported", "Delivery confirmation", "Completion verification"];
check(
  "24. simulator success flow: full evidence chain",
  chain.every((type) => reloaded.evidence.some((e: any) => e.type === type))
);

// ===========================================================================
// Mismatch flow: 470 -> MISMATCH -> exception -> resolve -> reconcile again
// ===========================================================================
console.log("--- mismatch flow ---");
const m = await createTx("PO-E2E-MISMATCH", 500, IN_DAYS(7));
await event(m.id, { type: "SUPPLIER_CONFIRMATION", source: "Supplier API" });
await event(m.id, { type: "FULFILLMENT_STARTED", source: "Supplier API" });
await event(m.id, {
  type: "DELIVERY_REPORTED",
  source: "Warehouse system",
  reportedQuantity: 500,
});
const mVer = await verify(m.id, {
  receivedQuantity: 470,
  deliveryDate: TODAY(),
  note: "30 units short.",
});
const mt = mVer.json.transaction;
check("4. reconciliation MISMATCH with difference -30", mt.reconciliations.at(-1)?.result === "MISMATCH" && mt.reconciliations.at(-1)?.difference === -30, mt.reconciliations.at(-1));
const mismatch = mt.exceptions.find((x: any) => x.type === "QUANTITY_MISMATCH");
check(
  "4/5. QUANTITY_MISMATCH created automatically with operational fields",
  !!mismatch &&
    mismatch.status === "OPEN" &&
    mismatch.blocking === true &&
    mismatch.severity === "HIGH" &&
    mismatch.expected === 500 &&
    mismatch.observed === 470 &&
    mismatch.difference === -30,
  mismatch
);
check(
  "4. exception explains expected vs observed",
  /500/.test(mismatch.description) && /470/.test(mismatch.description) && /-30/.test(mismatch.description),
  mismatch.description
);
check("6. blocked from completing (stays FULFILLING)", mt.state === "FULFILLING", mt.state);
check("6. completion blocked with reasons", mt.completionBlocking.length > 0, mt.completionBlocking);
check(
  "observed fact still recorded as verified evidence",
  ev(mt, "Delivery confirmation").length === 1 && ev(mt, "Delivery confirmation")[0].verified === true
);

const excList = await req("GET", "/api/exceptions?status=OPEN", undefined, token);
const excRow = (excList.json ?? []).find((x: any) => x.id === mismatch.id);
check(
  "6. exception list exposes severity/blocking/expected/observed",
  !!excRow &&
    excRow.severity === "HIGH" &&
    excRow.blocking === true &&
    excRow.expected === 500 &&
    excRow.observed === 470,
  excRow
);

summary = (await req("GET", "/api/summary", undefined, token)).json;
const excItem = (summary.actionRequired ?? []).find(
  (i: any) => i.id === `exception:${mismatch.id}`
);
check(
  "16. action-required: mismatch exception item (HIGH severity)",
  !!excItem && excItem.severity === "HIGH" && excItem.title === "Quantity mismatch detected",
  excItem
);
notif = await notifications(token);
check(
  "18. notification: QUANTITY_MISMATCH created",
  notif.notifications.some((n: any) => n.type === "QUANTITY_MISMATCH" && n.transactionId === m.id)
);

const resolve = await req(
  "POST",
  `/api/exceptions/${mismatch.id}/resolve`,
  { resolutionNote: "Supplier approved short shipment; remaining 30 units ship separately." },
  token
);
check("7. exception resolved by human", resolve.status === 200 && resolve.json.exception.status === "RESOLVED", resolve.status);
const mtAfter = await getTx(m.id);
check("8. reconciliation again after resolution -> COMPLETED", mtAfter.state === "COMPLETED", mtAfter.state);
check(
  "8. approved reconciliation recorded (expected/observed preserved)",
  mtAfter.reconciliations.some((r: any) => r.result === "MISMATCH" && r.received === 470) &&
    mtAfter.reconciliations.at(-1)?.result === "MATCH" &&
    mtAfter.reconciliations.at(-1)?.approved === true,
  mtAfter.reconciliations
);
check("21. re-evaluation audit event", mtAfter.activity.some((a: any) => a.type === "REEVALUATED"));
check(
  "21. exception audit events (EXCEPTION category)",
  mtAfter.activity.some((a: any) => a.type === "EXCEPTION_DETECTED" && a.category === "EXCEPTION") &&
    mtAfter.activity.some((a: any) => a.type === "EXCEPTION_RESOLVED" && a.category === "EXCEPTION")
);
check(
  "25. simulator mismatch flow: MISMATCH -> auto exception -> resolve -> COMPLETED",
  mtAfter.state === "COMPLETED" &&
    mtAfter.reconciliations.some((r: any) => r.result === "MISMATCH") &&
    !!mismatch &&
    resolve.status === 200
);
summary = (await req("GET", "/api/summary", undefined, token)).json;
check(
  "17. action-required mismatch item removed after resolution",
  !(summary.actionRequired ?? []).some((i: any) => i.id === `exception:${mismatch.id}`)
);
notif = await notifications(token);
check(
  "18. notification: EXCEPTION_RESOLVED created",
  notif.notifications.some((n: any) => n.type === "EXCEPTION_RESOLVED" && n.transactionId === m.id)
);

// ===========================================================================
// Automatic exceptions: delivery delay blocks completion; timer detection
// ===========================================================================
console.log("--- automatic exceptions ---");
const b = await createTx("PO-E2E-BLOCK", 500, IN_DAYS(7));
await event(b.id, { type: "SUPPLIER_CONFIRMATION", source: "Supplier API" });
await event(b.id, { type: "FULFILLMENT_STARTED", source: "Supplier API" });
await event(b.id, { type: "DELIVERY_REPORTED", source: "Warehouse system", reportedQuantity: 500 });
const delay = await event(b.id, { type: "DELIVERY_DELAYED", source: "Logistics provider" });
check(
  "5. external delay claim creates DELIVERY_DELAY exception",
  delay.status === 201 &&
    delay.json.transaction.exceptions.some((x: any) => x.type === "DELIVERY_DELAY" && x.status === "OPEN"),
  delay.status
);
const bVer = await verify(b.id, { receivedQuantity: 500, deliveryDate: TODAY() });
const bt = bVer.json.transaction;
check(
  "6. MATCH advances to DELIVERED but open exception blocks completion",
  bt.state === "DELIVERED",
  bt.state
);
check(
  "6. completion explains the blocking exception",
  bt.completionBlocking.some((r: string) => /Delivery delay/i.test(r)),
  bt.completionBlocking
);
const delayExc = bt.exceptions.find((x: any) => x.type === "DELIVERY_DELAY" && x.status === "OPEN");
await req(
  "POST",
  `/api/exceptions/${delayExc.id}/resolve`,
  { resolutionNote: "Delivery window extended and confirmed with logistics." },
  token
);
const btAfter = await getTx(b.id);
check("7/8. resolving re-evaluates DELIVERED transaction to COMPLETED", btAfter.state === "COMPLETED", btAfter.state);

const p = await createTx("PO-E2E-PAST", 500, YESTERDAY());
const pDetail = await getTx(p.id);
check(
  "5. engine timer creates DELIVERY_DELAY when delivery date passed",
  pDetail.exceptions.some((x: any) => x.type === "DELIVERY_DELAY" && x.status === "OPEN"),
  pDetail.exceptions
);
check("timer detection does not change state", pDetail.state === "CREATED", pDetail.state);
check(
  "timer detection audit event",
  pDetail.activity.some((a: any) => a.type === "EXCEPTION_DETECTED" && a.category === "EXCEPTION")
);

// ===========================================================================
// Policy-driven behavior
// ===========================================================================
console.log("--- policies drive behavior ---");
// 13. verification NOT required
const nv = await createTx("PO-E2E-NOVERIFY", 500, IN_DAYS(7), pNoVerify.id);
check("13. transaction attached to selected policy", nv.policy?.name === "Trusted delivery policy", nv.policy?.name);
await event(nv.id, { type: "SUPPLIER_CONFIRMATION", source: "Supplier API" });
await event(nv.id, { type: "FULFILLMENT_STARTED", source: "Supplier API" });
const nvDel = await event(nv.id, {
  type: "DELIVERY_REPORTED",
  source: "Warehouse system",
  reportedQuantity: 500,
});
check(
  "13. delivery auto-verified without human step -> COMPLETED",
  nvDel.json.transaction.state === "COMPLETED",
  nvDel.json.transaction.state
);
check("13. no verification task created", nvDel.json.awaitingVerification === false);
check("13. deliveryClaim null (nothing to confirm)", nvDel.json.transaction.deliveryClaim === null);
check(
  "13. auto-verified delivery evidence recorded",
  ev(nvDel.json.transaction, "Delivery confirmation").some(
    (e: any) => e.verified && /not required/.test(e.notes ?? "")
  )
);
summary = (await req("GET", "/api/summary", undefined, token)).json;
check(
  "13. no action-required verification item without required confirmation",
  !(summary.actionRequired ?? []).some((i: any) => i.id === `verify:${nv.id}`)
);
const nvNotif = await notifications(token);
check(
  "13. no VERIFICATION_REQUIRED notification for trusted policy",
  !nvNotif.notifications.some((n: any) => n.type === "VERIFICATION_REQUIRED" && n.transactionId === nv.id)
);

// 14. quantity tolerance
const tt = await createTx("PO-E2E-TOLERANCE", 500, IN_DAYS(7), pTol.id);
await event(tt.id, { type: "SUPPLIER_CONFIRMATION", source: "Supplier API" });
await event(tt.id, { type: "FULFILLMENT_STARTED", source: "Supplier API" });
await event(tt.id, { type: "DELIVERY_REPORTED", source: "Warehouse system", reportedQuantity: 500 });
const ttVer = await verify(tt.id, { receivedQuantity: 470, deliveryDate: TODAY() });
const ttt = ttVer.json.transaction;
check("14. mismatch within tolerance treated as MATCH", ttt.state === "COMPLETED", ttt.state);
check(
  "14. reconciliation records tolerance and within-tolerance result",
  ttt.reconciliations.at(-1)?.result === "MATCH" &&
    ttt.reconciliations.at(-1)?.tolerance === 40 &&
    ttt.reconciliations.at(-1)?.withinTolerance === true &&
    ttt.reconciliations.at(-1)?.difference === -30,
  ttt.reconciliations.at(-1)
);
check(
  "14. no exception created within tolerance",
  !ttt.exceptions.some((x: any) => x.type === "QUANTITY_MISMATCH")
);

// 15. non-blocking mismatches
const nb = await createTx("PO-E2E-NONBLOCK", 500, IN_DAYS(7), pNonBlock.id);
await event(nb.id, { type: "SUPPLIER_CONFIRMATION", source: "Supplier API" });
await event(nb.id, { type: "FULFILLMENT_STARTED", source: "Supplier API" });
await event(nb.id, { type: "DELIVERY_REPORTED", source: "Warehouse system", reportedQuantity: 500 });
const nbVer = await verify(nb.id, { receivedQuantity: 470, deliveryDate: TODAY() });
const nbt = nbVer.json.transaction;
const nbExc = nbt.exceptions.find((x: any) => x.type === "QUANTITY_MISMATCH");
check(
  "15. non-blocking mismatch exception created (blocking=false)",
  !!nbExc && nbExc.blocking === false && nbExc.status === "OPEN",
  nbExc
);
check(
  "15. non-blocking exception does not block completion",
  nbt.state === "COMPLETED" && nbt.completionBlocking.length === 0,
  { state: nbt.state, blocking: nbt.completionBlocking }
);

// ===========================================================================
// Invalid events and invalid state transitions
// ===========================================================================
console.log("--- invalid events and transitions ---");
const x = await createTx("PO-E2E-INVALID", 500, IN_DAYS(7));
const xFul = await event(x.id, { type: "FULFILLMENT_STARTED", source: "Supplier API" });
check("11. fulfillment before confirmation rejected (409)", xFul.status === 409, xFul.status);
const xDel = await event(x.id, { type: "DELIVERY_REPORTED", source: "Warehouse system" });
check("11. delivery before fulfillment rejected (409)", xDel.status === 409, xDel.status);
const badSource = await event(x.id, { type: "DELIVERY_REPORTED", source: "ERP" });
check("10. event from invalid source rejected (400)", badSource.status === 400, badSource.status);
const xDetail = await getTx(x.id);
const rejectedRow = (xDetail.events ?? []).find((e: any) => e.status === "REJECTED");
check(
  "20. rejected event recorded with detail",
  !!rejectedRow && /ERP/.test(rejectedRow.detail ?? "") && rejectedRow.result === "REJECTED",
  rejectedRow
);
check(
  "21. rejected event audited in activity",
  xDetail.activity.some((a: any) => a.type === "EVENT_REJECTED" && a.category === "EXECUTION")
);
const timeoutOnCompleted = await event(s.id, {
  type: "SUPPLIER_TIMEOUT",
  source: "Supplier API",
});
check(
  "10. supplier timeout after confirmation rejected (409)",
  timeoutOnCompleted.status === 409,
  timeoutOnCompleted.status
);

const manualState = await req("PATCH", `/api/transactions/${x.id}/state`, { state: "ACCEPTED" }, token);
check("11. manual state route removed (404)", manualState.status === 404, manualState.status);
const manualExecute = await req("POST", `/api/transactions/${x.id}/execute`, {}, token);
check("11. manual execute route removed (404)", manualExecute.status === 404, manualExecute.status);
const manualException = await req(
  "POST",
  `/api/transactions/${x.id}/exceptions`,
  { type: "QUANTITY_MISMATCH" },
  token
);
check("11. manual exception route removed (404)", manualException.status === 404, manualException.status);
const manualEvidence = await req(
  "POST",
  `/api/transactions/${x.id}/evidence`,
  { type: "X", source: "Y", reference: "Z" },
  token
);
check("manual evidence route removed (404)", manualEvidence.status === 404, manualEvidence.status);

// ===========================================================================
// Workspace authorization
// ===========================================================================
console.log("--- workspace authorization ---");
const regB = await req("POST", "/api/auth/register", {
  firstName: "E2E",
  lastName: "Other",
  email: `e2e-other-${stamp}@nobryn.test`,
  password: "password123",
  workspaceName: "E2E Workspace B",
});
check("22. second workspace registered", regB.status === 201, regB.status);
const tokenB = regB.json.token as string;

check(
  "22. foreign transaction read denied (404)",
  (await req("GET", `/api/transactions/${s.id}`, undefined, tokenB)).status === 404
);
check(
  "22. foreign event ingestion denied (404)",
  (
    await req(
      "POST",
      `/api/transactions/${s.id}/events`,
      { type: "SUPPLIER_CONFIRMATION", source: "Supplier API" },
      tokenB
    )
  ).status === 404
);
check(
  "22. foreign verification denied (404)",
  (await req("POST", `/api/transactions/${s.id}/verify`, { receivedQuantity: 1, deliveryDate: TODAY() }, tokenB)).status === 404
);
check(
  "22. foreign policy update denied (404)",
  (
    await req("PATCH", `/api/policies/${pTol.id}`, {
      name: "Hijacked",
      deliveryConfirmationRequired: true,
      quantityReconciliationRequired: true,
      quantityTolerance: 0,
      confirmationWindowHours: 24,
      blockingMismatches: true,
    }, tokenB)
  ).status === 404
);
const listB = await req("GET", "/api/transactions", undefined, tokenB);
check(
  "22. transaction listing scoped to workspace",
  Array.isArray(listB.json) && listB.json.length === 0,
  Array.isArray(listB.json) ? listB.json.length : listB.status
);
const notifB = await notifications(tokenB);
check(
  "22. notifications scoped to workspace",
  notifB.notifications.length === 0 && notifB.unreadCount === 0,
  notifB.unreadCount
);

// ===========================================================================
// Notification read state (last, after all notifications exist)
// ===========================================================================
console.log("--- notification read state ---");
const before = await notifications(token);
check("19. unread notifications exist", before.unreadCount >= 4, before.unreadCount);
const firstUnread = before.notifications.find((n: any) => !n.readAt);
const readRes = await req("POST", `/api/notifications/${firstUnread.id}/read`, {}, token);
check(
  "19. marking one notification read",
  readRes.status === 200 && !!readRes.json.notification?.readAt,
  readRes.status
);
const afterOne = await notifications(token);
check(
  "19. unread count decremented",
  afterOne.unreadCount === before.unreadCount - 1,
  { before: before.unreadCount, after: afterOne.unreadCount }
);
check(
  "19. read state persisted",
  !!afterOne.notifications.find((n: any) => n.id === firstUnread.id)?.readAt
);
const readAll = await req("POST", "/api/notifications/read-all", {}, token);
check("19. mark all read", readAll.status === 200, readAll.status);
const afterAll = await notifications(token);
check("19. unread count zero after read-all", afterAll.unreadCount === 0, afterAll.unreadCount);

// ===========================================================================
// Health / observability surface (public monitor target + dashboard snapshot)
// ===========================================================================
console.log("--- health & observability ---");

const SECRET_PATTERN = /DATABASE_URL|DATABASE_CA_CERT|BEGIN CERTIFICATE|JWT_SECRET|password|secret/i;

// Public, unauthenticated: this is exactly what a future external monitor
// will call (GET https://nobryn.onrender.com/health → expect HTTP 200).
const health = await req("GET", "/health");
check(
  "H. GET /health is public and returns 200",
  health.status === 200,
  health.status
);
check(
  "H. /health reports service, timestamp and uptime",
  health.json.service === "nobryn-api" &&
    typeof health.json.timestamp === "string" &&
    typeof health.json.uptime === "number",
  health.json
);
check(
  "H. /health response contains no secrets",
  !SECRET_PATTERN.test(JSON.stringify(health.json)),
  Object.keys(health.json)
);

const deep = await req("GET", "/health/deep");
check(
  "H. GET /health/deep is public and returns 200",
  deep.status === 200,
  deep.status
);
check(
  "H. /health/deep measures database status and latency",
  deep.json.status === "ok" &&
    deep.json.database?.status === "ok" &&
    typeof deep.json.database.latencyMs === "number" &&
    typeof deep.json.latencyMs === "number",
  deep.json
);
check(
  "H. /health/deep response contains no secrets",
  !SECRET_PATTERN.test(JSON.stringify(deep.json)),
  Object.keys(deep.json)
);

// Dashboard snapshot: session-protected, never anonymous.
const obsAnonymous = await req("GET", "/api/observability");
check(
  "H. /api/observability requires a session",
  obsAnonymous.status === 401,
  obsAnonymous.status
);
const obs = await req("GET", "/api/observability", undefined, token);
check(
  "H. /api/observability returns health + latency data",
  obs.status === 200 &&
    obs.json.database?.status === "ok" &&
    typeof obs.json.latency?.p95Ms === "number" &&
    typeof obs.json.api?.errorRatePercent === "number" &&
    Array.isArray(obs.json.recentRequests) &&
    Array.isArray(obs.json.slowOperations),
  Object.keys(obs.json)
);
check(
  "H. /api/observability response contains no secrets",
  !SECRET_PATTERN.test(JSON.stringify(obs.json)),
  Object.keys(obs.json)
);

// Page-level Overview endpoint (single round trip for the dashboard route).
const overview = await req("GET", "/api/overview", undefined, token);
check(
  "H. GET /api/overview returns every Overview section",
  overview.status === 200 &&
    typeof overview.json.cards?.activeTransactions === "number" &&
    Array.isArray(overview.json.recentTransactions) &&
    Array.isArray(overview.json.openExceptions) &&
    Array.isArray(overview.json.actionRequired) &&
    Array.isArray(overview.json.recentActivity),
  Object.keys(overview.json)
);
const summaryNow = await req("GET", "/api/summary", undefined, token);
check(
  "H. /api/overview matches the legacy /api/summary payload",
  JSON.stringify({
    cards: overview.json.cards,
    recentTransactions: overview.json.recentTransactions,
    openExceptions: overview.json.openExceptions,
    actionRequired: overview.json.actionRequired,
  }) === JSON.stringify(summaryNow.json),
  "shape drift"
);

// --- cleanup ---------------------------------------------------------------
await cleanup();

finish("Nobryn E2E suite");
