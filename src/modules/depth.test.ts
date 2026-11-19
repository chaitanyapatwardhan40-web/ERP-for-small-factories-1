import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createTestDb, type Db } from "@/lib/db";
import { customerPrices, customers, invoices, items, journalLines, locations, orgs, purchaseOrderLines, users, vendorItems, vendors } from "@/lib/db/schema";
import { balanceOfSubtype, seedBooks } from "@/modules/books/service";
import { createBillFromPo, createPurchaseOrder, receivePurchaseOrder, setPoStatus, shortageReport, updatePurchaseOrder, upsertVendorItem } from "@/modules/purchasing/service";
import { addOrderLine, cancelOrder, cancelOrderLine, confirmOrder, createOrder, resolveSalesPrice, SalesError } from "@/modules/sales/service";
import { createCreditMemo, createInvoiceFromShipment, recordCustomerPayment, shipOrderInFull, voidInvoice } from "@/modules/shipping/service";
import { importBankLines, autoMatchBank, bankSummary, postTemplate, saveTemplate, salesTaxReport } from "@/modules/books/extras";
import { inventoryLedgerValue } from "@/modules/inventory/service";
import { accounts } from "@/lib/db/schema";

let db: Db;
let actor: { orgId: string; userId: string };
const id: Record<string, string> = {};
const D = "2026-11-18";

async function balanced() {
  const [row] = await db.select({ d: sql<number>`coalesce(sum(${journalLines.debit}),0)`.mapWith(Number), c: sql<number>`coalesce(sum(${journalLines.credit}),0)`.mapWith(Number) }).from(journalLines).where(eq(journalLines.orgId, actor.orgId));
  return Math.abs(row.d - row.c) < 0.005;
}

beforeAll(async () => {
  db = await createTestDb();
  const [org] = await db.insert(orgs).values({ name: "Depth Shop", slug: "depth", settings: { overReceiptPct: 10 } }).returning();
  const [user] = await db.insert(users).values({ email: "o@depth.test", name: "Owner", passwordHash: "x" }).returning();
  actor = { orgId: org.id, userId: user.id };
  await seedBooks(db, org.id, 2026);
  const [loc] = await db.insert(locations).values({ orgId: org.id, code: "MAIN", name: "Main stock" }).returning();
  id.loc = loc.id;
  const [cust] = await db.insert(customers).values({ orgId: org.id, code: "C1", name: "Credit Co", termsDays: 30, creditLimit: 500, discountPct: 10 }).returning();
  id.cust = cust.id;
  const [vend] = await db.insert(vendors).values({ orgId: org.id, code: "V1", name: "Bolt Supply", termsDays: 30, leadTimeDays: 7 }).returning();
  id.vend = vend.id;
  const [bolt] = await db.insert(items).values({ orgId: org.id, sku: "BOLT", name: "Bolt", type: "buy", standardCost: 2, salesPrice: 5, reorderPoint: 0, reorderQty: 0, safetyStock: 50, minOrderQty: 100, preferredVendorId: vend.id }).returning();
  id.bolt = bolt.id;
});

describe("purchasing depth", () => {
  it("fills PO cost and part number from the vendor price list, bills service lines to expense", async () => {
    await upsertVendorItem(db, actor, { vendorId: id.vend, itemId: id.bolt, vendorPartNo: "BS-100", lastCost: 1.75, preferred: true });
    const po = await createPurchaseOrder(db, actor, { vendorId: id.vend, orderDate: D, lines: [{ itemId: id.bolt, qty: 100 }, { description: "Inbound freight", qty: 1, unitCost: 40 }] });
    const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id));
    const item = lines.find((l) => l.lineType === "item")!;
    expect(Number(item.unitCost)).toBe(1.75);
    expect(item.vendorPartNo).toBe("BS-100");
    expect(lines.find((l) => l.lineType === "service")!.itemId).toBeNull();
    expect(Number(po.subtotal)).toBe(215);
    await setPoStatus(db, actor, po.id, "sent");
    id.po = po.id;
  });

  it("edits a sent PO as a new revision and refuses after receipts", async () => {
    await updatePurchaseOrder(db, actor, id.po, { vendorId: id.vend, orderDate: D, lines: [{ itemId: id.bolt, qty: 120 }, { description: "Inbound freight", qty: 1, unitCost: 40 }] });
    const { purchaseOrders } = await import("@/lib/db/schema");
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id.po));
    expect(po.revision).toBe(2);
    expect(Number(po.subtotal)).toBe(250);
  });

  it("allows a receipt within the over-receipt tolerance and updates the price list", async () => {
    const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, id.po));
    const item = lines.find((l) => l.lineType === "item")!;
    await expect(receivePurchaseOrder(db, actor, { poId: id.po, lines: [{ poLineId: item.id, qty: 140, locationId: id.loc }] })).rejects.toThrow(/left to receive/);
    await receivePurchaseOrder(db, actor, { poId: id.po, receivedAt: new Date(`${D}T12:00:00`), lines: [{ poLineId: item.id, qty: 130, locationId: id.loc }] });
    const [vi] = await db.select().from(vendorItems).where(and(eq(vendorItems.vendorId, id.vend), eq(vendorItems.itemId, id.bolt)));
    expect(vi.lastPurchasedAt).toBe(D);
    await expect(updatePurchaseOrder(db, actor, id.po, { vendorId: id.vend, orderDate: D, lines: [{ itemId: id.bolt, qty: 1 }] })).rejects.toThrow(/cannot be edited|received or billed/);
  });

  it("bills received goods plus the service line and freight, posting expense and accrued purchases", async () => {
    const accruedBefore = await balanceOfSubtype(db, actor.orgId, "accrued_purchases");
    const bill = await createBillFromPo(db, actor, { poId: id.po, billDate: D, freight: 12 });
    expect(Number(bill.subtotal)).toBe(130 * 1.75 + 40);
    expect(Number(bill.freight)).toBe(12);
    expect(Number(bill.total)).toBe(130 * 1.75 + 40 + 12);
    const accruedAfter = await balanceOfSubtype(db, actor.orgId, "accrued_purchases");
    expect(Math.abs(accruedAfter - accruedBefore + 130 * 1.75)).toBeLessThan(0.01);
    expect(await balanced()).toBe(true);
  });

  it("shortage report honours safety stock, minimum order and the preferred price", async () => {
    const [bolt2] = await db.insert(items).values({ orgId: actor.orgId, sku: "NUT", name: "Nut", type: "buy", standardCost: 0.5, safetyStock: 30, minOrderQty: 500, preferredVendorId: id.vend }).returning();
    await upsertVendorItem(db, actor, { vendorId: id.vend, itemId: bolt2.id, lastCost: 0.42, leadTimeDays: 3, preferred: true });
    const report = await shortageReport(db, actor.orgId);
    const row = report.find((r) => r.itemId === bolt2.id)!;
    expect(row.safetyStock).toBe(30);
    expect(row.suggestedQty).toBe(500);
    expect(row.lastCost).toBe(0.42);
    expect(row.leadTimeDays).toBe(3);
  });
});

describe("sales depth", () => {
  it("resolves prices from customer and general lists with quantity breaks", async () => {
    await db.insert(customerPrices).values([
      { orgId: actor.orgId, customerId: null, itemId: id.bolt, minQty: 0, unitPrice: 4.5 },
      { orgId: actor.orgId, customerId: id.cust, itemId: id.bolt, minQty: 0, unitPrice: 4 },
      { orgId: actor.orgId, customerId: id.cust, itemId: id.bolt, minQty: 50, unitPrice: 3.5 },
      { orgId: actor.orgId, customerId: id.cust, itemId: id.bolt, minQty: 0, unitPrice: 1, validTo: "2020-01-01" },
    ]);
    expect(await resolveSalesPrice(db, actor.orgId, id.cust, id.bolt, 10, D)).toBe(4);
    expect(await resolveSalesPrice(db, actor.orgId, id.cust, id.bolt, 60, D)).toBe(3.5);
    expect(await resolveSalesPrice(db, actor.orgId, null, id.bolt, 10, D)).toBe(4.5);
    // The editor gets the same answer from the hints without a round trip.
    const { priceHintsFor } = await import("@/modules/sales/service");
    const { hintPrice } = await import("@/components/forms/line-editor");
    const hints = await priceHintsFor(db, actor.orgId, id.cust, D);
    expect(hints[id.bolt].price).toBe(4);
    expect(hintPrice(hints[id.bolt], 10)).toBe(4);
    expect(hintPrice(hints[id.bolt], 60)).toBe(3.5);
    expect(hintPrice((await priceHintsFor(db, actor.orgId, null, D))[id.bolt], 60)).toBe(4.5);
  });

  it("creates an order with list prices and the customer's standard discount, then enforces the credit limit", async () => {
    const order = await createOrder(db, actor, { customerId: id.cust, orderDate: D, lines: [{ itemId: id.bolt, qty: 60 }, { itemId: id.bolt, qty: 50, unitPrice: 10, discountPct: 0 }] });
    expect(Number(order.subtotal)).toBe(60 * 3.5 * 0.9 + 500);
    await expect(confirmOrder(db, actor, order.id)).rejects.toThrow(SalesError);
    await confirmOrder(db, actor, order.id, { overrideCredit: true });
    await addOrderLine(db, actor, order.id, { itemId: id.bolt, qty: 5 }, "test");
    const { salesOrderLines } = await import("@/lib/db/schema");
    const lines = await db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id));
    const extra = lines.find((l) => l.lineNo === 3)!;
    expect(Number(extra.unitPrice)).toBe(4);
    await cancelOrderLine(db, actor, extra.id, "not needed");
    const [after] = await db.select({ subtotal: sql<number>`subtotal`.mapWith(Number) }).from((await import("@/lib/db/schema")).salesOrders).where(eq((await import("@/lib/db/schema")).salesOrders.id, order.id));
    expect(after.subtotal).toBe(60 * 3.5 * 0.9 + 500);
    id.order = order.id;
  });

  it("invoices with discounts and freight, issues a credit memo, voids a fresh invoice", async () => {
    const sh = await shipOrderInFull(db, actor, id.order, id.loc, { freightCharge: 25 });
    const inv = await createInvoiceFromShipment(db, actor, { shipmentId: sh.id, issueDate: D, taxRatePct: 8 });
    const goods = 60 * 3.5 * 0.9 + 500;
    expect(Number(inv.subtotal)).toBeCloseTo(goods + 25, 2);
    expect(Number(inv.tax)).toBeCloseTo(goods * 0.08, 2);
    const cm = await createCreditMemo(db, actor, { invoiceId: inv.id, amount: 100, reason: "damaged", issueDate: D, restock: [{ itemId: id.bolt, qty: 2, locationId: id.loc }] });
    expect(cm.kind).toBe("credit_memo");
    const [invAfter] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    expect(Number(invAfter.amountPaid)).toBe(100);
    expect(await balanced()).toBe(true);
    const ledgerInv = await inventoryLedgerValue(db, actor.orgId);
    const [{ v }] = await db.select({ v: sql<number>`coalesce(sum(qty * unit_cost),0)`.mapWith(Number) }).from((await import("@/lib/db/schema")).inventoryTransactions).where(eq((await import("@/lib/db/schema")).inventoryTransactions.orgId, actor.orgId));
    expect(Math.abs(ledgerInv - v)).toBeLessThan(0.01);
    await expect(voidInvoice(db, actor, inv.id, "x")).rejects.toThrow(/payments/);
    id.inv = inv.id;
  });

  it("applies one payment across invoices and keeps the remainder unapplied", async () => {
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id.inv));
    const open = Number(inv.total) - Number(inv.amountPaid);
    const pay = await recordCustomerPayment(db, actor, { customerId: id.cust, amount: open + 50, paidAt: D, applications: [{ invoiceId: inv.id, amount: open }] });
    expect(Number(pay.unapplied)).toBe(50);
    const [after] = await db.select().from(invoices).where(eq(invoices.id, id.inv));
    expect(after.status).toBe("paid");
    const tax = await salesTaxReport(db, actor.orgId, "2026-01-01", "2026-12-31");
    expect(tax.length).toBe(1);
    expect(tax[0].tax).toBeCloseTo(Number(inv.tax), 2);
    expect(await balanced()).toBe(true);
  });
});

describe("books depth", () => {
  it("posts a recurring template and matches a bank line to the payment", async () => {
    const [cash] = await db.select().from(accounts).where(and(eq(accounts.orgId, actor.orgId), eq(accounts.subtype, "cash")));
    const [opex] = await db.select().from(accounts).where(and(eq(accounts.orgId, actor.orgId), eq(accounts.subtype, "operating_expense")));
    const tid = await saveTemplate(db, actor, { name: "Rent", frequency: "monthly", nextDate: D, lines: [{ accountId: opex.id, debit: 100, credit: 0 }, { accountId: cash.id, debit: 0, credit: 100 }] });
    await postTemplate(db, actor, tid, D);
    const { journalTemplates } = await import("@/lib/db/schema");
    const [t] = await db.select().from(journalTemplates).where(eq(journalTemplates.id, tid));
    expect(t.nextDate).toBe("2026-12-18");
    const { customerPayments } = await import("@/lib/db/schema");
    const [pay] = await db.select().from(customerPayments).where(eq(customerPayments.orgId, actor.orgId));
    const r = await importBankLines(db, actor, cash.id, [{ postedAt: D, description: "DEPOSIT CREDIT CO", amount: Number(pay.amount) }, { postedAt: D, description: "DEPOSIT CREDIT CO", amount: Number(pay.amount) }]);
    expect(r.added).toBe(1);
    expect(await autoMatchBank(db, actor)).toBe(1);
    const s = await bankSummary(db, actor.orgId);
    expect(s.unmatched).toBe(0);
    expect(await balanced()).toBe(true);
  });
});

describe("deleting drafts", () => {
  it("removes draft POs, quotes, orders and planned work orders, and refuses anything further along", async () => {
    const { deletePurchaseOrder, PurchasingError } = await import("@/modules/purchasing/service");
    const { createQuote, deleteQuote, deleteOrder, acceptQuote } = await import("@/modules/sales/service");
    const { createWorkOrder, deleteWorkOrder, createWorkOrdersForOrder, releaseWorkOrder, ProductionError } = await import("@/modules/production/service");
    const { purchaseOrders, quotes, salesOrders, workOrders } = await import("@/lib/db/schema");

    // A draft PO goes; the received one from earlier does not.
    const draft = await createPurchaseOrder(db, actor, { vendorId: id.vend, orderDate: D, lines: [{ itemId: id.bolt, qty: 5 }] });
    await deletePurchaseOrder(db, actor, draft.id);
    expect((await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, draft.id))).length).toBe(0);
    await expect(deletePurchaseOrder(db, actor, id.po)).rejects.toThrow(PurchasingError);

    // A quote goes until an order is made from it.
    const q1 = await createQuote(db, actor, { customerId: id.cust, quoteDate: D, lines: [{ itemId: id.bolt, description: "Bolt", qty: 10 }] });
    await deleteQuote(db, actor, q1.id);
    expect((await db.select().from(quotes).where(eq(quotes.id, q1.id))).length).toBe(0);
    const q2 = await createQuote(db, actor, { customerId: id.cust, quoteDate: D, lines: [{ itemId: id.bolt, description: "Bolt", qty: 10 }] });
    const fromQuote = await acceptQuote(db, actor, q2.id);
    await expect(deleteQuote(db, actor, q2.id)).rejects.toThrow(SalesError);

    // A make item, an order with a work order on it: the order is blocked until the WO goes.
    const [widget] = await db.insert(items).values({ orgId: actor.orgId, sku: "WIDGET", name: "Widget", type: "make", standardCost: 20, salesPrice: 50 }).returning();
    const order = await createOrder(db, actor, { customerId: id.cust, orderDate: D, lines: [{ itemId: widget.id, qty: 2 }] });
    await confirmOrder(db, actor, order.id);
    const [wo] = await createWorkOrdersForOrder(db, actor, order.id);
    expect((await db.select().from(salesOrders).where(eq(salesOrders.id, order.id)))[0].status).toBe("in_production");
    await expect(deleteOrder(db, actor, order.id)).rejects.toThrow(/work orders/);
    await deleteWorkOrder(db, actor, wo.id);
    expect((await db.select().from(workOrders).where(eq(workOrders.id, wo.id))).length).toBe(0);
    expect((await db.select().from(salesOrders).where(eq(salesOrders.id, order.id)))[0].status).toBe("confirmed");
    // A cancelled order with a work order still on it waits for the work order.
    const [again] = await createWorkOrdersForOrder(db, actor, order.id);
    await cancelOrder(db, actor, order.id, "customer pulled it");
    await expect(deleteOrder(db, actor, order.id)).rejects.toThrow(/work orders/);
    await deleteWorkOrder(db, actor, again.id);
    await deleteOrder(db, actor, order.id);
    expect((await db.select().from(salesOrders).where(eq(salesOrders.id, order.id))).length).toBe(0);
    // The draft made from the quote can go too.
    await deleteOrder(db, actor, fromQuote.id);
    expect((await db.select().from(salesOrders).where(eq(salesOrders.id, fromQuote.id))).length).toBe(0);

    // A released work order with nothing on it can still go; one that has started cannot.
    const wo2 = await createWorkOrder(db, actor, { itemId: widget.id, qty: 1 });
    await releaseWorkOrder(db, actor, wo2.id);
    await deleteWorkOrder(db, actor, wo2.id);
    const wo3 = await createWorkOrder(db, actor, { itemId: widget.id, qty: 1 });
    await db.update(workOrders).set({ status: "in_progress" }).where(eq(workOrders.id, wo3.id));
    await expect(deleteWorkOrder(db, actor, wo3.id)).rejects.toThrow(ProductionError);
  });
});

describe("leads", () => {
  it("carries a lead through quoting to won, reusing the existing customer", async () => {
    const { leads } = await import("@/lib/db/schema");
    const { createQuote, acceptQuote, setQuoteStatus } = await import("@/modules/sales/service");
    const [lead] = await db.insert(leads).values({ orgId: actor.orgId, company: "Credit Co", stage: "contacted" }).returning();
    const q = await createQuote(db, actor, { customerId: id.cust, quoteDate: D, leadId: lead.id, lines: [{ itemId: id.bolt, description: "Bolt", qty: 10 }] });
    let [l] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(l.stage).toBe("quoting");
    expect(l.customerId).toBe(id.cust);
    await acceptQuote(db, actor, q.id, "PO-9");
    [l] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(l.stage).toBe("won");
    const q2 = await createQuote(db, actor, { customerId: id.cust, quoteDate: D, leadId: lead.id, lines: [{ itemId: id.bolt, description: "Bolt", qty: 1 }] });
    await setQuoteStatus(db, actor, q2.id, "lost", "too slow");
    [l] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(l.stage).toBe("lost");
    expect(l.lostReason).toBe("too slow");
  });
});

describe("assistant", () => {
  it("reads amounts but not the digits of document numbers", async () => {
    const { parseMoney } = await import("@/modules/assistant/parse");
    expect(parseMoney("payment on INV-00086")).toBeNull();
    expect(parseMoney("pay BILL-00012")).toBeNull();
    expect(parseMoney("payment 12.50 on INV-00086")).toBe(12.5);
    expect(parseMoney("pay $1,250 on bill 00012")).toBe(1250);
    expect(parseMoney("paid 500")).toBe(500);
  });
});
