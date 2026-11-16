import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, type Db } from "@/lib/db";
import {
  bomLines,
  bomRevisions,
  customers,
  employees,
  items,
  journalEntries,
  journalLines,
  locations,
  orgs,
  routingOperations,
  routings,
  users,
  vendors,
  workCenters,
  workOrderOperations,
  workOrders,
} from "@/lib/db/schema";
import { accountBalances, balanceOfSubtype, balanceSheet, profitAndLoss, seedBooks } from "@/modules/books/service";
import { inventoryLedgerValue, onHand } from "@/modules/inventory/service";
import { createPurchaseOrder, createBillFromPo, payBill, receivePurchaseOrder, setPoStatus, shortageReport } from "@/modules/purchasing/service";
import { acceptQuote, confirmOrder, createQuote, priceFromCost } from "@/modules/sales/service";
import { completeWorkOrder, createWorkOrdersForOrder, issueAllMaterials, recordLabor, releaseWorkOrder } from "@/modules/production/service";
import { arAging, createInvoiceFromShipment, recordCustomerPayment, shipOrderInFull } from "@/modules/shipping/service";

let db: Db;
let actor: { orgId: string; userId: string };
let main: string;
const id: Record<string, string> = {};
const D = "2026-11-16";

beforeAll(async () => {
  db = await createTestDb();
  const [org] = await db.insert(orgs).values({ name: "Flow Shop", slug: "flow" }).returning();
  const [user] = await db.insert(users).values({ email: "o@flow.test", name: "Owner", passwordHash: "x" }).returning();
  actor = { orgId: org.id, userId: user.id };
  await seedBooks(db, org.id, 2026);
  const [loc] = await db.insert(locations).values({ orgId: org.id, code: "MAIN", name: "Main stock" }).returning();
  main = loc.id;
  const [cust] = await db.insert(customers).values({ orgId: org.id, code: "C1", name: "Acme Robotics", termsDays: 30 }).returning();
  id.cust = cust.id;
  const [vend] = await db.insert(vendors).values({ orgId: org.id, code: "V1", name: "Metal Supply", termsDays: 30, leadTimeDays: 7 }).returning();
  id.vend = vend.id;
  const [wc] = await db.insert(workCenters).values({ orgId: org.id, code: "ASM", name: "Assembly", hourlyRate: 50 }).returning();
  const [kit] = await db.insert(items).values({ orgId: org.id, sku: "KIT-1", name: "Sensor kit", type: "make", salesPrice: 100 }).returning();
  const [plate] = await db.insert(items).values({ orgId: org.id, sku: "PLATE", name: "Plate", type: "buy", standardCost: 10, reorderPoint: 5, reorderQty: 20 }).returning();
  const [screw] = await db.insert(items).values({ orgId: org.id, sku: "SCREW", name: "Screw", type: "buy", standardCost: 0.1 }).returning();
  id.kit = kit.id;
  id.plate = plate.id;
  id.screw = screw.id;
  const [bom] = await db.insert(bomRevisions).values({ orgId: org.id, itemId: kit.id, rev: "A", status: "active" }).returning();
  await db.insert(bomLines).values([
    { orgId: org.id, bomRevisionId: bom.id, componentItemId: plate.id, qty: 1 },
    { orgId: org.id, bomRevisionId: bom.id, componentItemId: screw.id, qty: 4 },
  ]);
  const [rt] = await db.insert(routings).values({ orgId: org.id, itemId: kit.id, rev: "A", status: "active" }).returning();
  await db.insert(routingOperations).values({ orgId: org.id, routingId: rt.id, seq: 10, name: "Assemble", workCenterId: wc.id, setupHours: 0, runHoursPerUnit: 0.2 });
  const [emp] = await db.insert(employees).values({ orgId: org.id, name: "Pat", hourlyRate: 25 }).returning();
  id.emp = emp.id;
});

async function allEntriesBalance() {
  const rows = await db
    .select({
      entryId: journalLines.entryId,
      debit: sql<number>`sum(${journalLines.debit})`.mapWith(Number),
      credit: sql<number>`sum(${journalLines.credit})`.mapWith(Number),
    })
    .from(journalLines)
    .groupBy(journalLines.entryId);
  for (const r of rows) expect(r.debit).toBeCloseTo(r.credit, 4);
  return rows.length;
}

describe("quote to cash, with the books posting from every event", () => {
  it("prices a quote from cost and margin", () => {
    expect(priceFromCost({ description: "x", qty: 1, materialCost: 50, laborCost: 20, marginPct: 30 })).toBeCloseTo(100, 4);
  });

  it("buys material: PO -> receipt posts Inventory / Accrued purchases; bill and payment follow", async () => {
    const po = await createPurchaseOrder(db, actor, {
      vendorId: id.vend,
      orderDate: D,
      lines: [
        { itemId: id.plate, qty: 20, unitCost: 10 },
        { itemId: id.screw, qty: 500, unitCost: 0.1 },
      ],
    });
    await setPoStatus(db, actor, po.id, "sent");
    const [l1, l2] = await db.query.purchaseOrderLines.findMany({ where: (t, { eq }) => eq(t.poId, po.id), orderBy: (t, { asc }) => asc(t.lineNo) });
    await receivePurchaseOrder(db, actor, { poId: po.id, lines: [{ poLineId: l1.id, qty: 20, locationId: main }, { poLineId: l2.id, qty: 500, locationId: main }] });
    expect(await onHand(db, actor.orgId, id.plate)).toBe(20);
    expect(await balanceOfSubtype(db, actor.orgId, "inventory")).toBeCloseTo(250, 4);
    expect(await balanceOfSubtype(db, actor.orgId, "accrued_purchases")).toBeCloseTo(250, 4);

    const bill = await createBillFromPo(db, actor, { poId: po.id, billDate: D });
    expect(Number(bill.total)).toBeCloseTo(250, 4);
    expect(await balanceOfSubtype(db, actor.orgId, "accrued_purchases")).toBeCloseTo(0, 4);
    expect(await balanceOfSubtype(db, actor.orgId, "accounts_payable")).toBeCloseTo(250, 4);
    await payBill(db, actor, { billId: bill.id, amount: 250, paidAt: D });
    expect(await balanceOfSubtype(db, actor.orgId, "accounts_payable")).toBeCloseTo(0, 4);
    expect(await balanceOfSubtype(db, actor.orgId, "cash")).toBeCloseTo(-250, 4);
  });

  it("sells: quote -> order -> work order -> issue -> labour -> complete -> ship -> invoice -> payment", async () => {
    const quote = await createQuote(db, actor, {
      customerId: id.cust,
      quoteDate: D,
      lines: [{ itemId: id.kit, description: "Sensor kit", qty: 10, materialCost: 10.4, laborCost: 10, marginPct: 20, leadTimeDays: 7 }],
    });
    // unit price = 20.4 / 0.8 = 25.5
    const order = await acceptQuote(db, actor, quote.id, "PO-ACME-1");
    expect(Number(order.subtotal)).toBeCloseTo(255, 4);
    await confirmOrder(db, actor, order.id);

    const [wo] = await createWorkOrdersForOrder(db, actor, order.id);
    expect(wo.number).toBe("WO-00001");
    const mats = await db.query.workOrderMaterials.findMany({ where: (t, { eq }) => eq(t.workOrderId, wo.id) });
    expect(mats.find((m) => m.itemId === id.plate)?.qtyRequired).toBe(10);
    expect(mats.find((m) => m.itemId === id.screw)?.qtyRequired).toBe(40);

    await releaseWorkOrder(db, actor, wo.id);
    const short = await issueAllMaterials(db, actor, wo.id, main);
    expect(short).toEqual([]);
    expect(await onHand(db, actor.orgId, id.plate)).toBe(10);
    // WIP got 10 plates * 10 + 40 screws * 0.1 = 104
    expect(await balanceOfSubtype(db, actor.orgId, "wip")).toBeCloseTo(104, 4);

    const [op] = await db.select().from(workOrderOperations).where(eq(workOrderOperations.workOrderId, wo.id));
    await recordLabor(db, actor, { operationId: op.id, employeeId: id.emp, hours: 2, qtyGood: 10, operationComplete: true });
    // labour 2h * $25 = 50 -> WIP 154
    expect(await balanceOfSubtype(db, actor.orgId, "wip")).toBeCloseTo(154, 4);

    const done = await completeWorkOrder(db, actor, { workOrderId: wo.id, qtyGood: 10, qtyScrap: 0, locationId: main, overheadPct: 10 });
    // overhead 10% of labour = 5 -> total 159, unit cost 15.9
    expect(done.totalCost).toBeCloseTo(159, 4);
    expect(done.unitCost).toBeCloseTo(15.9, 4);
    expect(await balanceOfSubtype(db, actor.orgId, "wip")).toBeCloseTo(0, 4);
    expect(await onHand(db, actor.orgId, id.kit)).toBe(10);
    const [woRow] = await db.select().from(workOrders).where(eq(workOrders.id, wo.id));
    expect(woRow.status).toBe("complete");

    const sh = await shipOrderInFull(db, actor, order.id, main, { carrier: "UPS", tracking: "1Z" });
    expect(await onHand(db, actor.orgId, id.kit)).toBe(0);
    expect(await balanceOfSubtype(db, actor.orgId, "cogs")).toBeCloseTo(159, 4);
    const orderAfterShip = await db.query.salesOrders.findFirst({ where: (t, { eq }) => eq(t.id, order.id) });
    expect(orderAfterShip?.status).toBe("shipped");

    const inv = await createInvoiceFromShipment(db, actor, { shipmentId: sh.id, issueDate: D, taxRatePct: 8 });
    expect(Number(inv.subtotal)).toBeCloseTo(255, 4);
    expect(Number(inv.tax)).toBeCloseTo(20.4, 4);
    expect(await balanceOfSubtype(db, actor.orgId, "accounts_receivable")).toBeCloseTo(275.4, 4);
    expect(await balanceOfSubtype(db, actor.orgId, "revenue")).toBeCloseTo(255, 4);
    const orderAfterInvoice = await db.query.salesOrders.findFirst({ where: (t, { eq }) => eq(t.id, order.id) });
    expect(orderAfterInvoice?.status).toBe("invoiced");

    const aging = await arAging(db, actor.orgId, "2027-01-20");
    expect(aging.buckets.total).toBeCloseTo(275.4, 4);
    expect(aging.buckets.d31_60).toBeCloseTo(275.4, 4);

    await recordCustomerPayment(db, actor, { invoiceId: inv.id, amount: 275.4, paidAt: D, method: "ach" });
    expect(await balanceOfSubtype(db, actor.orgId, "accounts_receivable")).toBeCloseTo(0, 4);
    expect(await balanceOfSubtype(db, actor.orgId, "cash")).toBeCloseTo(25.4, 4);
  });

  it("keeps every entry balanced, inventory equal to the ledger, and the balance sheet in balance", async () => {
    const entries = await allEntriesBalance();
    expect(entries).toBeGreaterThan(8);
    const ledger = await inventoryLedgerValue(db, actor.orgId);
    const glInventory = await balanceOfSubtype(db, actor.orgId, "inventory");
    // 10 plates ($100) + 460 screws ($46) left in stock
    expect(ledger).toBeCloseTo(146, 4);
    expect(glInventory).toBeCloseTo(ledger, 4);

    const bs = await balanceSheet(db, actor.orgId, "2026-12-31");
    expect(bs.totalAssets).toBeCloseTo(bs.totalLiabilities + bs.totalEquity, 4);

    const pnl = await profitAndLoss(db, actor.orgId, "2026-01-01", "2026-12-31");
    // revenue 255 - cogs 159 - (labour absorbed -50, overhead absorbed -5 are credits, i.e. negative expense)
    expect(pnl.totalRevenue).toBeCloseTo(255, 4);
    expect(pnl.netIncome).toBeCloseTo(255 - 159 + 50 + 5, 4);

    const balances = await accountBalances(db, actor.orgId);
    const tax = balances.find((b) => b.subtype === "sales_tax_payable");
    expect(tax?.balance).toBeCloseTo(20.4, 4);
    const count = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(journalEntries);
    expect(count[0].n).toBe(entries);
  });

  it("suggests what to buy from reorder points and open demand", async () => {
    const report = await shortageReport(db, actor.orgId);
    // 10 plates on hand, reorder point 5 -> nothing yet
    expect(report.find((r) => r.sku === "PLATE")).toBeUndefined();
    const quote = await createQuote(db, actor, { customerId: id.cust, quoteDate: D, lines: [{ itemId: id.kit, description: "Sensor kit", qty: 30, unitPrice: 25 }] });
    const order = await acceptQuote(db, actor, quote.id);
    await confirmOrder(db, actor, order.id);
    await createWorkOrdersForOrder(db, actor, order.id);
    const after = await shortageReport(db, actor.orgId);
    const plate = after.find((r) => r.sku === "PLATE");
    expect(plate).toBeDefined();
    expect(plate!.demand).toBe(30);
    expect(plate!.onHand).toBe(10);
    // need: point 5 - (10 - 30) = 25, at least reorder qty 20 -> 25
    expect(plate!.suggestedQty).toBe(25);
  });
});
