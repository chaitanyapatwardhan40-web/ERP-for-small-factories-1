import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import {
  inventoryTransactions,
  items,
  purchaseOrderLines,
  purchaseOrders,
  receiptLines,
  receipts,
  salesOrderLines,
  salesOrders,
  vendorBillLines,
  vendorBills,
  vendorPayments,
  vendors,
  workOrderMaterials,
  workOrders,
  type AccountSubtype,
} from "@/lib/db/schema";
import { nextNumber } from "@/lib/numbering";
import { audit } from "@/lib/audit";
import { addDays, round4 } from "@/lib/money";
import { moveStock } from "@/modules/inventory/service";
import { postEvent } from "@/modules/books/service";

export class PurchasingError extends Error {}
type Actor = { orgId: string; userId: string };

export type PoLineInput = { itemId: string; description?: string; qty: number; unitCost: number; expectedDate?: string | null };

export async function createPurchaseOrder(
  db: DbOrTx,
  actor: Actor,
  input: {
    vendorId: string;
    orderDate: string;
    expectedDate?: string | null;
    notes?: string | null;
    workOrderId?: string | null;
    lines: PoLineInput[];
  },
) {
  if (!input.lines.length) throw new PurchasingError("A PO needs at least one line");
  const [vendor] = await db
    .select()
    .from(vendors)
    .where(and(eq(vendors.id, input.vendorId), eq(vendors.orgId, actor.orgId)));
  if (!vendor) throw new PurchasingError("Vendor not found");
  const itemRows = await db
    .select({ id: items.id, name: items.name })
    .from(items)
    .where(and(eq(items.orgId, actor.orgId), inArray(items.id, input.lines.map((l) => l.itemId))));
  const number = await nextNumber(db, actor.orgId, "po");
  const expected = input.expectedDate ?? addDays(input.orderDate, vendor.leadTimeDays);
  const subtotal = round4(input.lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitCost), 0));
  const [po] = await db
    .insert(purchaseOrders)
    .values({
      orgId: actor.orgId,
      number,
      vendorId: input.vendorId,
      orderDate: input.orderDate,
      expectedDate: expected,
      notes: input.notes ?? null,
      workOrderId: input.workOrderId ?? null,
      subtotal,
    })
    .returning();
  await db.insert(purchaseOrderLines).values(
    input.lines.map((l, i) => {
      const it = itemRows.find((r) => r.id === l.itemId);
      if (!it) throw new PurchasingError(`Item not found on line ${i + 1}`);
      return {
        orgId: actor.orgId,
        poId: po.id,
        lineNo: i + 1,
        itemId: l.itemId,
        description: l.description || it.name,
        qty: Number(l.qty),
        unitCost: round4(Number(l.unitCost)),
        expectedDate: l.expectedDate ?? expected,
      };
    }),
  );
  await audit(db, { ...actor, action: "po.create", entityType: "po", entityId: po.id });
  return po;
}

export async function setPoStatus(
  db: DbOrTx,
  actor: Actor,
  poId: string,
  status: "sent" | "confirmed" | "cancelled" | "closed",
  extra: { confirmedDate?: string; vendorRef?: string } = {},
) {
  const [po] = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.orgId, actor.orgId)));
  if (!po) throw new PurchasingError("PO not found");
  if (status === "cancelled" && ["partially_received", "received"].includes(po.status)) {
    throw new PurchasingError("Received POs cannot be cancelled");
  }
  await db
    .update(purchaseOrders)
    .set({
      status,
      confirmedDate: extra.confirmedDate ?? po.confirmedDate,
      vendorRef: extra.vendorRef ?? po.vendorRef,
      updatedAt: new Date(),
    })
    .where(eq(purchaseOrders.id, poId));
  await audit(db, { ...actor, action: `po.${status}`, entityType: "po", entityId: poId });
}

export type ReceiveLine = { poLineId: string; qty: number; lotNumber?: string | null; locationId: string };

/**
 * Receive goods against a PO. Each line becomes an inventory receipt valued at
 * the PO cost and posts Inventory / Accrued purchases. Outside-processing POs
 * (raised from a work order) post straight to WIP instead.
 */
export async function receivePurchaseOrder(
  db: DbOrTx,
  actor: Actor,
  input: { poId: string; receivedAt?: Date; packingSlip?: string | null; notes?: string | null; lines: ReceiveLine[] },
) {
  const [po] = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, input.poId), eq(purchaseOrders.orgId, actor.orgId)));
  if (!po) throw new PurchasingError("PO not found");
  if (["draft", "cancelled", "closed"].includes(po.status)) throw new PurchasingError(`PO is ${po.status}; send it first`);
  const lines = input.lines.filter((l) => Number(l.qty) > 0);
  if (!lines.length) throw new PurchasingError("Nothing to receive");
  const poLines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id));
  const number = await nextNumber(db, actor.orgId, "receipt");
  const receivedAt = input.receivedAt ?? new Date();
  const date = receivedAt.toISOString().slice(0, 10);
  const [receipt] = await db
    .insert(receipts)
    .values({ orgId: actor.orgId, number, poId: po.id, receivedAt, receivedBy: actor.userId, packingSlip: input.packingSlip ?? null, notes: input.notes ?? null })
    .returning();

  for (const l of lines) {
    const pl = poLines.find((p) => p.id === l.poLineId);
    if (!pl) throw new PurchasingError("PO line not found");
    const remaining = Number(pl.qty) - Number(pl.qtyReceived);
    if (Number(l.qty) > remaining + 1e-9) throw new PurchasingError(`Line ${pl.lineNo}: only ${remaining} left to receive`);
    await db.insert(receiptLines).values({
      orgId: actor.orgId,
      receiptId: receipt.id,
      poLineId: pl.id,
      itemId: pl.itemId,
      qty: Number(l.qty),
      unitCost: Number(pl.unitCost),
      lotNumber: l.lotNumber ?? null,
      locationId: l.locationId,
    });
    if (po.workOrderId) {
      // Outside processing: the value goes to WIP, no stock movement of the service.
      const value = round4(Number(l.qty) * Number(pl.unitCost));
      await postEvent(db, { orgId: actor.orgId, event: "production.outside", amount: value, date, memo: `${po.number} outside processing`, sourceType: "receipt", sourceId: receipt.id });
      await db
        .update(workOrders)
        .set({ outsideCost: sql`${workOrders.outsideCost} + ${value}`, updatedAt: new Date() })
        .where(eq(workOrders.id, po.workOrderId));
    } else {
      await moveStock(db, {
        orgId: actor.orgId,
        userId: actor.userId,
        itemId: pl.itemId,
        locationId: l.locationId,
        qty: Number(l.qty),
        unitCost: Number(pl.unitCost),
        type: "receipt",
        lotNumber: l.lotNumber ?? null,
        refType: "receipt",
        refId: receipt.id,
        memo: `${po.number} line ${pl.lineNo}`,
        date,
        glEvent: "purchase.receipt",
      });
    }
    await db
      .update(purchaseOrderLines)
      .set({ qtyReceived: round4(Number(pl.qtyReceived) + Number(l.qty)), updatedAt: new Date() })
      .where(eq(purchaseOrderLines.id, pl.id));
  }
  const after = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id));
  const allReceived = after.every((p) => Number(p.qtyReceived) >= Number(p.qty) - 1e-9);
  await db
    .update(purchaseOrders)
    .set({ status: allReceived ? "received" : "partially_received", updatedAt: new Date() })
    .where(eq(purchaseOrders.id, po.id));
  await audit(db, { ...actor, action: "po.receive", entityType: "po", entityId: po.id, data: { receiptId: receipt.id } });
  return receipt;
}

/** Bill for everything received and not yet billed on a PO. */
export async function createBillFromPo(
  db: DbOrTx,
  actor: Actor,
  input: { poId: string; billDate: string; dueDate?: string | null; vendorRef?: string | null; tax?: number },
) {
  const [po] = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, input.poId), eq(purchaseOrders.orgId, actor.orgId)));
  if (!po) throw new PurchasingError("PO not found");
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, po.vendorId));
  const poLines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id)).orderBy(asc(purchaseOrderLines.lineNo));
  const billable = poLines.filter((l) => Number(l.qtyReceived) - Number(l.qtyBilled) > 1e-9);
  if (!billable.length) throw new PurchasingError("Nothing received and unbilled on this PO");
  const number = await nextNumber(db, actor.orgId, "bill");
  const subtotal = round4(billable.reduce((s, l) => s + (Number(l.qtyReceived) - Number(l.qtyBilled)) * Number(l.unitCost), 0));
  const tax = round4(Number(input.tax ?? 0));
  const [bill] = await db
    .insert(vendorBills)
    .values({
      orgId: actor.orgId,
      number,
      vendorId: po.vendorId,
      poId: po.id,
      vendorRef: input.vendorRef ?? null,
      status: "approved",
      billDate: input.billDate,
      dueDate: input.dueDate ?? addDays(input.billDate, vendor?.termsDays ?? 30),
      subtotal,
      tax,
      total: round4(subtotal + tax),
    })
    .returning();
  for (const l of billable) {
    const q = round4(Number(l.qtyReceived) - Number(l.qtyBilled));
    await db.insert(vendorBillLines).values({
      orgId: actor.orgId,
      billId: bill.id,
      poLineId: l.id,
      itemId: l.itemId,
      description: l.description,
      qty: q,
      unitCost: Number(l.unitCost),
      amount: round4(q * Number(l.unitCost)),
    });
    await db.update(purchaseOrderLines).set({ qtyBilled: round4(Number(l.qtyBilled) + q) }).where(eq(purchaseOrderLines.id, l.id));
  }
  await postEvent(db, { orgId: actor.orgId, event: "purchase.bill", amount: subtotal, date: input.billDate, memo: `${bill.number} ${vendor?.name ?? ""}`, sourceType: "bill", sourceId: bill.id });
  if (tax > 0) {
    await postEvent(db, { orgId: actor.orgId, event: "purchase.expense_bill", amount: tax, date: input.billDate, memo: `${bill.number} tax`, sourceType: "bill", sourceId: bill.id });
  }
  await audit(db, { ...actor, action: "bill.create", entityType: "bill", entityId: bill.id });
  return bill;
}

/** A bill with no PO: rent, utilities, tooling. Posts expense / AP. */
export async function createExpenseBill(
  db: DbOrTx,
  actor: Actor,
  input: { vendorId: string; billDate: string; dueDate?: string | null; vendorRef?: string | null; description: string; amount: number; expenseSubtype?: AccountSubtype },
) {
  const [vendor] = await db.select().from(vendors).where(and(eq(vendors.id, input.vendorId), eq(vendors.orgId, actor.orgId)));
  if (!vendor) throw new PurchasingError("Vendor not found");
  const amount = round4(Number(input.amount));
  if (amount <= 0) throw new PurchasingError("Amount must be positive");
  const number = await nextNumber(db, actor.orgId, "bill");
  const [bill] = await db
    .insert(vendorBills)
    .values({
      orgId: actor.orgId,
      number,
      vendorId: vendor.id,
      vendorRef: input.vendorRef ?? null,
      status: "approved",
      billDate: input.billDate,
      dueDate: input.dueDate ?? addDays(input.billDate, vendor.termsDays),
      subtotal: amount,
      total: amount,
      expenseSubtype: input.expenseSubtype ?? "operating_expense",
    })
    .returning();
  await db.insert(vendorBillLines).values({ orgId: actor.orgId, billId: bill.id, description: input.description, qty: 1, unitCost: amount, amount });
  await postEvent(db, {
    orgId: actor.orgId,
    event: "purchase.expense_bill",
    amount,
    date: input.billDate,
    memo: `${bill.number} ${input.description}`,
    sourceType: "bill",
    sourceId: bill.id,
    debitSubtype: input.expenseSubtype ?? "operating_expense",
  });
  return bill;
}

export async function payBill(
  db: DbOrTx,
  actor: Actor,
  input: { billId: string; amount: number; paidAt: string; method?: "check" | "ach" | "card" | "cash" | "other"; reference?: string | null },
) {
  const [bill] = await db.select().from(vendorBills).where(and(eq(vendorBills.id, input.billId), eq(vendorBills.orgId, actor.orgId)));
  if (!bill) throw new PurchasingError("Bill not found");
  if (bill.status === "void") throw new PurchasingError("Bill is void");
  const amount = round4(Number(input.amount));
  const open = round4(Number(bill.total) - Number(bill.amountPaid));
  if (amount <= 0 || amount > open + 1e-9) throw new PurchasingError(`Payment must be between 0 and ${open}`);
  const number = await nextNumber(db, actor.orgId, "vpayment");
  const [pay] = await db
    .insert(vendorPayments)
    .values({ orgId: actor.orgId, number, vendorId: bill.vendorId, billId: bill.id, amount, paidAt: input.paidAt, method: input.method ?? "check", reference: input.reference ?? null })
    .returning();
  await postEvent(db, { orgId: actor.orgId, event: "purchase.payment", amount, date: input.paidAt, memo: `${pay.number} for ${bill.number}`, sourceType: "vendor_payment", sourceId: pay.id });
  const paid = round4(Number(bill.amountPaid) + amount);
  await db
    .update(vendorBills)
    .set({ amountPaid: paid, status: paid >= Number(bill.total) - 1e-9 ? "paid" : bill.status, updatedAt: new Date() })
    .where(eq(vendorBills.id, bill.id));
  return pay;
}

export async function listPurchaseOrders(db: DbOrTx, orgId: string) {
  return db
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      status: purchaseOrders.status,
      orderDate: purchaseOrders.orderDate,
      expectedDate: purchaseOrders.expectedDate,
      confirmedDate: purchaseOrders.confirmedDate,
      subtotal: purchaseOrders.subtotal,
      vendorName: vendors.name,
      vendorId: vendors.id,
      workOrderId: purchaseOrders.workOrderId,
    })
    .from(purchaseOrders)
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .where(eq(purchaseOrders.orgId, orgId))
    .orderBy(desc(purchaseOrders.orderDate), desc(purchaseOrders.number));
}

export type Shortage = {
  itemId: string;
  sku: string;
  name: string;
  type: string;
  onHand: number;
  demand: number;
  onOrder: number;
  reorderPoint: number;
  reorderQty: number;
  suggestedQty: number;
  preferredVendorId: string | null;
  lastCost: number;
  leadTimeDays: number;
};

/**
 * What to buy: demand from open work orders and confirmed orders for buy
 * items, minus stock, minus open POs, topped up to the reorder quantity.
 */
export async function shortageReport(db: DbOrTx, orgId: string): Promise<Shortage[]> {
  const onHandRows = await db
    .select({ itemId: inventoryTransactions.itemId, qty: sql<number>`coalesce(sum(${inventoryTransactions.qty}), 0)`.mapWith(Number) })
    .from(inventoryTransactions)
    .where(eq(inventoryTransactions.orgId, orgId))
    .groupBy(inventoryTransactions.itemId);
  const woDemand = await db
    .select({
      itemId: workOrderMaterials.itemId,
      qty: sql<number>`coalesce(sum(${workOrderMaterials.qtyRequired} - ${workOrderMaterials.qtyIssued}), 0)`.mapWith(Number),
    })
    .from(workOrderMaterials)
    .innerJoin(workOrders, eq(workOrders.id, workOrderMaterials.workOrderId))
    .where(and(eq(workOrderMaterials.orgId, orgId), inArray(workOrders.status, ["planned", "released", "in_progress"])))
    .groupBy(workOrderMaterials.itemId);
  const soDemand = await db
    .select({
      itemId: salesOrderLines.itemId,
      qty: sql<number>`coalesce(sum(${salesOrderLines.qty} - ${salesOrderLines.qtyShipped}), 0)`.mapWith(Number),
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
    .innerJoin(items, eq(items.id, salesOrderLines.itemId))
    .where(and(eq(salesOrderLines.orgId, orgId), inArray(salesOrders.status, ["confirmed", "in_production", "partially_shipped"]), eq(items.type, "buy")))
    .groupBy(salesOrderLines.itemId);
  const onOrder = await db
    .select({
      itemId: purchaseOrderLines.itemId,
      qty: sql<number>`coalesce(sum(${purchaseOrderLines.qty} - ${purchaseOrderLines.qtyReceived}), 0)`.mapWith(Number),
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.poId))
    .where(and(eq(purchaseOrderLines.orgId, orgId), inArray(purchaseOrders.status, ["sent", "confirmed", "partially_received"]), ne(purchaseOrders.status, "cancelled")))
    .groupBy(purchaseOrderLines.itemId);
  const all = await db.select().from(items).where(and(eq(items.orgId, orgId), eq(items.status, "active")));
  const out: Shortage[] = [];
  for (const it of all) {
    if (it.type === "make" || it.type === "phantom" || it.type === "service") continue;
    const onHand = onHandRows.find((r) => r.itemId === it.id)?.qty ?? 0;
    const demand = (woDemand.find((r) => r.itemId === it.id)?.qty ?? 0) + (soDemand.find((r) => r.itemId === it.id)?.qty ?? 0);
    const ordered = onOrder.find((r) => r.itemId === it.id)?.qty ?? 0;
    const available = onHand + ordered - demand;
    const point = Number(it.reorderPoint);
    if (available < point || available < 0) {
      const need = Math.max(point - available, -available, 0);
      const suggested = round4(Math.max(need, Number(it.reorderQty)));
      out.push({
        itemId: it.id,
        sku: it.sku,
        name: it.name,
        type: it.type,
        onHand: round4(onHand),
        demand: round4(demand),
        onOrder: round4(ordered),
        reorderPoint: point,
        reorderQty: Number(it.reorderQty),
        suggestedQty: suggested,
        preferredVendorId: it.preferredVendorId,
        lastCost: Number(it.lastCost) || Number(it.standardCost),
        leadTimeDays: it.leadTimeDays,
      });
    }
  }
  return out.sort((a, b) => a.onHand - a.demand - (b.onHand - b.demand));
}
