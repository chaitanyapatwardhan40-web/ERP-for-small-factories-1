import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import {
  inventoryTransactions,
  items,
  orgs,
  purchaseOrderLines,
  purchaseOrders,
  receiptLines,
  receipts,
  salesOrderLines,
  salesOrders,
  vendorBillLines,
  vendorBills,
  vendorItems,
  vendorPayments,
  vendors,
  workOrderMaterials,
  workOrders,
  type AccountSubtype,
  type Address,
} from "@/lib/db/schema";
import { nextNumber } from "@/lib/numbering";
import { audit } from "@/lib/audit";
import { addDays, round4 } from "@/lib/money";
import { moveStock } from "@/modules/inventory/service";
import { postEvent } from "@/modules/books/service";

export class PurchasingError extends Error {}
type Actor = { orgId: string; userId: string };

export type PoLineInput = {
  itemId?: string | null;
  lineType?: "item" | "service";
  description?: string | null;
  vendorPartNo?: string | null;
  qty: number;
  unitCost?: number | null;
  expectedDate?: string | null;
  notes?: string | null;
  expenseSubtype?: AccountSubtype | null;
};

export type PoHeaderInput = {
  vendorId: string;
  orderDate: string;
  expectedDate?: string | null;
  notes?: string | null;
  internalNotes?: string | null;
  workOrderId?: string | null;
  termsDays?: number | null;
  shipVia?: string | null;
  freight?: number | null;
  tax?: number | null;
  shipTo?: Address | null;
  vendorRef?: string | null;
};

export const PO_OPEN_STATUSES = ["sent", "confirmed", "partially_received"] as const;

/** Total of a PO including freight and tax. */
export function poTotal(po: { subtotal: number; freight: number; tax: number }) {
  return round4(Number(po.subtotal) + Number(po.freight) + Number(po.tax));
}

/**
 * Fill in what the form left blank: description from the item, unit cost and
 * vendor part number from the vendor's price list, then the item's last or
 * standard cost.
 */
async function resolveLines(db: DbOrTx, actor: Actor, vendorId: string, lines: PoLineInput[], fallbackDate: string | null) {
  const itemIds = lines.map((l) => l.itemId).filter((x): x is string => !!x);
  const [itemRows, priceRows] = await Promise.all([
    itemIds.length ? db.select({ id: items.id, name: items.name, lastCost: items.lastCost, standardCost: items.standardCost }).from(items).where(and(eq(items.orgId, actor.orgId), inArray(items.id, itemIds))) : Promise.resolve([]),
    itemIds.length ? db.select().from(vendorItems).where(and(eq(vendorItems.orgId, actor.orgId), eq(vendorItems.vendorId, vendorId), inArray(vendorItems.itemId, itemIds))) : Promise.resolve([]),
  ]);
  return lines.map((l, i) => {
    const qty = Number(l.qty);
    if (!(qty > 0)) throw new PurchasingError(`Line ${i + 1}: quantity must be positive`);
    if (l.itemId) {
      const it = itemRows.find((r) => r.id === l.itemId);
      if (!it) throw new PurchasingError(`Item not found on line ${i + 1}`);
      const vp = priceRows.find((r) => r.itemId === l.itemId);
      const unitCost = l.unitCost != null && Number(l.unitCost) > 0 ? Number(l.unitCost) : Number(vp?.lastCost) || Number(it.lastCost) || Number(it.standardCost) || 0;
      return {
        orgId: actor.orgId,
        lineNo: i + 1,
        itemId: l.itemId,
        lineType: "item" as const,
        description: l.description?.trim() || it.name,
        vendorPartNo: l.vendorPartNo?.trim() || vp?.vendorPartNo || null,
        qty,
        unitCost: round4(unitCost),
        expectedDate: l.expectedDate ?? fallbackDate,
        notes: l.notes?.trim() || null,
        expenseSubtype: null,
      };
    }
    if (!l.description?.trim()) throw new PurchasingError(`Line ${i + 1}: a non-stock line needs a description`);
    return {
      orgId: actor.orgId,
      lineNo: i + 1,
      itemId: null,
      lineType: "service" as const,
      description: l.description.trim(),
      vendorPartNo: l.vendorPartNo?.trim() || null,
      qty,
      unitCost: round4(Number(l.unitCost ?? 0)),
      expectedDate: l.expectedDate ?? fallbackDate,
      notes: l.notes?.trim() || null,
      expenseSubtype: l.expenseSubtype ?? "operating_expense",
    };
  });
}

async function loadVendor(db: DbOrTx, actor: Actor, vendorId: string) {
  const [vendor] = await db
    .select()
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), eq(vendors.orgId, actor.orgId)));
  if (!vendor) throw new PurchasingError("Vendor not found");
  return vendor;
}

/** The shop's own address, used as the default ship-to on a PO. */
export async function companyShipTo(db: DbOrTx, orgId: string): Promise<Address | null> {
  const [org] = await db.select({ settings: orgs.settings }).from(orgs).where(eq(orgs.id, orgId));
  return org?.settings.company?.address ?? null;
}

export async function createPurchaseOrder(db: DbOrTx, actor: Actor, input: PoHeaderInput & { lines: PoLineInput[] }) {
  if (!input.lines.length) throw new PurchasingError("A PO needs at least one line");
  const vendor = await loadVendor(db, actor, input.vendorId);
  const expected = input.expectedDate ?? addDays(input.orderDate, vendor.leadTimeDays);
  const lines = await resolveLines(db, actor, vendor.id, input.lines, expected);
  const number = await nextNumber(db, actor.orgId, "po");
  const subtotal = round4(lines.reduce((s, l) => s + l.qty * l.unitCost, 0));
  const [po] = await db
    .insert(purchaseOrders)
    .values({
      orgId: actor.orgId,
      number,
      vendorId: vendor.id,
      orderDate: input.orderDate,
      expectedDate: expected,
      notes: input.notes ?? null,
      internalNotes: input.internalNotes ?? null,
      workOrderId: input.workOrderId ?? null,
      termsDays: input.termsDays ?? vendor.termsDays,
      shipVia: input.shipVia ?? vendor.shipVia ?? null,
      freight: round4(Number(input.freight ?? 0)),
      tax: round4(Number(input.tax ?? 0)),
      shipTo: input.shipTo ?? (await companyShipTo(db, actor.orgId)),
      vendorRef: input.vendorRef ?? null,
      buyerId: actor.userId,
      subtotal,
    })
    .returning();
  await db.insert(purchaseOrderLines).values(lines.map((l) => ({ ...l, poId: po.id })));
  await audit(db, { ...actor, action: "po.create", entityType: "po", entityId: po.id });
  return po;
}

/**
 * Edit a PO that has not been received against. A sent PO gets a new
 * revision number so the vendor can tell the copies apart.
 */
export async function updatePurchaseOrder(db: DbOrTx, actor: Actor, poId: string, input: PoHeaderInput & { lines: PoLineInput[] }) {
  const [po] = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.orgId, actor.orgId)));
  if (!po) throw new PurchasingError("PO not found");
  if (!["draft", "sent", "confirmed"].includes(po.status)) throw new PurchasingError(`A ${po.status.replaceAll("_", " ")} PO cannot be edited`);
  const existing = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id));
  if (existing.some((l) => Number(l.qtyReceived) > 0 || Number(l.qtyBilled) > 0)) throw new PurchasingError("Lines have been received or billed; close the PO and raise a new one instead");
  if (!input.lines.length) throw new PurchasingError("A PO needs at least one line");
  const vendor = await loadVendor(db, actor, input.vendorId);
  const expected = input.expectedDate ?? po.expectedDate ?? addDays(input.orderDate, vendor.leadTimeDays);
  const lines = await resolveLines(db, actor, vendor.id, input.lines, expected);
  const subtotal = round4(lines.reduce((s, l) => s + l.qty * l.unitCost, 0));
  await db.delete(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id));
  await db.insert(purchaseOrderLines).values(lines.map((l) => ({ ...l, poId: po.id })));
  await db
    .update(purchaseOrders)
    .set({
      vendorId: vendor.id,
      orderDate: input.orderDate,
      expectedDate: expected,
      notes: input.notes ?? null,
      internalNotes: input.internalNotes ?? null,
      termsDays: input.termsDays ?? po.termsDays,
      shipVia: input.shipVia ?? null,
      freight: round4(Number(input.freight ?? 0)),
      tax: round4(Number(input.tax ?? 0)),
      shipTo: input.shipTo ?? po.shipTo,
      vendorRef: input.vendorRef ?? po.vendorRef,
      subtotal,
      revision: po.status === "draft" ? po.revision : po.revision + 1,
      updatedAt: new Date(),
    })
    .where(eq(purchaseOrders.id, po.id));
  await audit(db, { ...actor, action: "po.update", entityType: "po", entityId: po.id, data: { revision: po.status === "draft" ? po.revision : po.revision + 1 } });
  return po;
}

export async function setPoStatus(
  db: DbOrTx,
  actor: Actor,
  poId: string,
  status: "sent" | "confirmed" | "cancelled" | "closed",
  extra: { confirmedDate?: string; vendorRef?: string; reason?: string } = {},
) {
  const [po] = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.orgId, actor.orgId)));
  if (!po) throw new PurchasingError("PO not found");
  if (status === "cancelled" && ["partially_received", "received", "closed"].includes(po.status)) {
    throw new PurchasingError("Received POs cannot be cancelled; close them short instead");
  }
  if (status === "closed" && ["draft", "cancelled"].includes(po.status)) throw new PurchasingError("Only sent or received POs can be closed");
  const now = new Date();
  await db
    .update(purchaseOrders)
    .set({
      status,
      confirmedDate: extra.confirmedDate ?? po.confirmedDate,
      vendorRef: extra.vendorRef ?? po.vendorRef,
      sentAt: status === "sent" ? now : po.sentAt,
      closedAt: status === "closed" || status === "cancelled" ? now : po.closedAt,
      cancelReason: extra.reason ?? po.cancelReason,
      updatedAt: now,
    })
    .where(eq(purchaseOrders.id, poId));
  if (status === "closed" || status === "cancelled") {
    // Whatever was not received is cancelled, so it stops counting as on order.
    await db
      .update(purchaseOrderLines)
      .set({ qtyCancelled: sql`greatest(${purchaseOrderLines.qty} - ${purchaseOrderLines.qtyReceived}, 0)`, updatedAt: now })
      .where(eq(purchaseOrderLines.poId, poId));
  }
  await audit(db, { ...actor, action: `po.${status}`, entityType: "po", entityId: poId, data: extra.reason ? { reason: extra.reason } : undefined });
}

export type ReceiveLine = { poLineId: string; qty: number; lotNumber?: string | null; locationId: string };

/**
 * Receive goods against a PO. Each line becomes an inventory receipt valued at
 * the PO cost and posts Inventory / Accrued purchases. Outside-processing POs
 * (raised from a work order) post straight to WIP instead. Service lines are
 * never received; they are billed.
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
  const [org] = await db.select({ settings: orgs.settings }).from(orgs).where(eq(orgs.id, actor.orgId));
  const tolerance = Number(org?.settings.overReceiptPct ?? 0) / 100;
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
    if (pl.lineType !== "item" || !pl.itemId) throw new PurchasingError(`Line ${pl.lineNo} is a service line; it is billed, not received`);
    const remaining = Number(pl.qty) - Number(pl.qtyReceived) - Number(pl.qtyCancelled);
    const allowed = remaining * (1 + tolerance);
    if (Number(l.qty) > allowed + 1e-9) {
      throw new PurchasingError(`Line ${pl.lineNo}: only ${round4(remaining)} left to receive${tolerance ? ` (${org?.settings.overReceiptPct}% over-receipt allowed)` : ""}`);
    }
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
    // Keep the vendor's price list current.
    await db
      .insert(vendorItems)
      .values({ orgId: actor.orgId, vendorId: po.vendorId, itemId: pl.itemId, vendorPartNo: pl.vendorPartNo, lastCost: Number(pl.unitCost), lastPurchasedAt: date })
      .onConflictDoUpdate({
        target: [vendorItems.orgId, vendorItems.vendorId, vendorItems.itemId],
        set: { lastCost: Number(pl.unitCost), lastPurchasedAt: date, vendorPartNo: sql`coalesce(${pl.vendorPartNo}, ${vendorItems.vendorPartNo})`, updatedAt: new Date() },
      });
  }
  const after = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id));
  const allReceived = after.filter((p) => p.lineType === "item").every((p) => Number(p.qtyReceived) + Number(p.qtyCancelled) >= Number(p.qty) - 1e-9);
  await db
    .update(purchaseOrders)
    .set({ status: allReceived ? "received" : "partially_received", updatedAt: new Date() })
    .where(eq(purchaseOrders.id, po.id));
  await audit(db, { ...actor, action: "po.receive", entityType: "po", entityId: po.id, data: { receiptId: receipt.id } });
  return receipt;
}

/**
 * Bill a PO: received-and-unbilled item lines clear accrued purchases;
 * service lines and freight/tax post to expense. One PO can be billed
 * several times as partial deliveries arrive.
 */
export async function createBillFromPo(
  db: DbOrTx,
  actor: Actor,
  input: { poId: string; billDate: string; dueDate?: string | null; vendorRef?: string | null; tax?: number; freight?: number; notes?: string | null },
) {
  const [po] = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, input.poId), eq(purchaseOrders.orgId, actor.orgId)));
  if (!po) throw new PurchasingError("PO not found");
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, po.vendorId));
  const poLines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id)).orderBy(asc(purchaseOrderLines.lineNo));
  const billableItems = poLines.filter((l) => l.lineType === "item" && Number(l.qtyReceived) - Number(l.qtyBilled) > 1e-9);
  const billableServices = poLines.filter((l) => l.lineType === "service" && Number(l.qty) - Number(l.qtyBilled) > 1e-9);
  const tax = round4(Number(input.tax ?? 0));
  const freight = round4(Number(input.freight ?? 0));
  if (!billableItems.length && !billableServices.length && tax <= 0 && freight <= 0) throw new PurchasingError("Nothing received and unbilled on this PO");
  const number = await nextNumber(db, actor.orgId, "bill");
  const itemsSubtotal = round4(billableItems.reduce((s, l) => s + (Number(l.qtyReceived) - Number(l.qtyBilled)) * Number(l.unitCost), 0));
  const servicesSubtotal = round4(billableServices.reduce((s, l) => s + (Number(l.qty) - Number(l.qtyBilled)) * Number(l.unitCost), 0));
  const subtotal = round4(itemsSubtotal + servicesSubtotal);
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
      dueDate: input.dueDate ?? addDays(input.billDate, po.termsDays ?? vendor?.termsDays ?? 30),
      subtotal,
      tax,
      freight,
      total: round4(subtotal + tax + freight),
      notes: input.notes ?? null,
    })
    .returning();
  for (const l of [...billableItems, ...billableServices]) {
    const q = l.lineType === "item" ? round4(Number(l.qtyReceived) - Number(l.qtyBilled)) : round4(Number(l.qty) - Number(l.qtyBilled));
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
    await db.update(purchaseOrderLines).set({ qtyBilled: round4(Number(l.qtyBilled) + q), updatedAt: new Date() }).where(eq(purchaseOrderLines.id, l.id));
  }
  if (itemsSubtotal > 0) {
    await postEvent(db, { orgId: actor.orgId, event: "purchase.bill", amount: itemsSubtotal, date: input.billDate, memo: `${bill.number} ${vendor?.name ?? ""}`, sourceType: "bill", sourceId: bill.id });
  }
  for (const l of billableServices) {
    const amount = round4((Number(l.qty) - Number(l.qtyBilled)) * Number(l.unitCost));
    if (amount <= 0) continue;
    await postEvent(db, { orgId: actor.orgId, event: "purchase.expense_bill", amount, date: input.billDate, memo: `${bill.number} ${l.description}`, sourceType: "bill", sourceId: bill.id, debitSubtype: (l.expenseSubtype as AccountSubtype | null) ?? "operating_expense" });
  }
  if (tax > 0) {
    await postEvent(db, { orgId: actor.orgId, event: "purchase.expense_bill", amount: tax, date: input.billDate, memo: `${bill.number} tax`, sourceType: "bill", sourceId: bill.id });
  }
  if (freight > 0) {
    await postEvent(db, { orgId: actor.orgId, event: "purchase.expense_bill", amount: freight, date: input.billDate, memo: `${bill.number} freight in`, sourceType: "bill", sourceId: bill.id, debitSubtype: "cogs" });
  }
  await audit(db, { ...actor, action: "bill.create", entityType: "bill", entityId: bill.id });
  return bill;
}

/** A bill with no PO: rent, utilities, tooling. Posts expense / AP. */
export async function createExpenseBill(
  db: DbOrTx,
  actor: Actor,
  input: { vendorId: string; billDate: string; dueDate?: string | null; vendorRef?: string | null; description: string; amount: number; expenseSubtype?: AccountSubtype; notes?: string | null },
) {
  const vendor = await loadVendor(db, actor, input.vendorId);
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
      notes: input.notes ?? null,
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
  await audit(db, { ...actor, action: "bill.create", entityType: "bill", entityId: bill.id });
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
  await audit(db, { ...actor, action: "bill.pay", entityType: "bill", entityId: bill.id, data: { paymentId: pay.id, amount } });
  return pay;
}

/** Void an unpaid bill: reverses its postings. */
export async function voidBill(db: DbOrTx, actor: Actor, billId: string, reason: string) {
  const [bill] = await db.select().from(vendorBills).where(and(eq(vendorBills.id, billId), eq(vendorBills.orgId, actor.orgId)));
  if (!bill) throw new PurchasingError("Bill not found");
  if (Number(bill.amountPaid) > 0) throw new PurchasingError("A bill with payments cannot be voided");
  if (bill.status === "void") return bill;
  const { reverseSource } = await import("@/modules/books/service");
  await reverseSource(db, actor, "bill", bill.id, `Void ${bill.number}: ${reason}`);
  const lines = await db.select().from(vendorBillLines).where(eq(vendorBillLines.billId, bill.id));
  for (const l of lines) {
    if (l.poLineId) await db.update(purchaseOrderLines).set({ qtyBilled: sql`greatest(${purchaseOrderLines.qtyBilled} - ${Number(l.qty)}, 0)` }).where(eq(purchaseOrderLines.id, l.poLineId));
  }
  await db.update(vendorBills).set({ status: "void", notes: [bill.notes, `Void: ${reason}`].filter(Boolean).join("\n"), updatedAt: new Date() }).where(eq(vendorBills.id, bill.id));
  await audit(db, { ...actor, action: "bill.void", entityType: "bill", entityId: bill.id, data: { reason } });
  return bill;
}

export async function listPurchaseOrders(db: DbOrTx, orgId: string, filter: { status?: string; vendorId?: string; q?: string } = {}) {
  const conds = [eq(purchaseOrders.orgId, orgId)];
  if (filter.status === "open") conds.push(inArray(purchaseOrders.status, [...PO_OPEN_STATUSES]));
  else if (filter.status) conds.push(eq(purchaseOrders.status, filter.status as (typeof purchaseOrders.$inferSelect)["status"]));
  if (filter.vendorId) conds.push(eq(purchaseOrders.vendorId, filter.vendorId));
  if (filter.q) conds.push(or(ilike(purchaseOrders.number, `%${filter.q}%`), ilike(vendors.name, `%${filter.q}%`), ilike(purchaseOrders.vendorRef, `%${filter.q}%`))!);
  return db
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      status: purchaseOrders.status,
      orderDate: purchaseOrders.orderDate,
      expectedDate: purchaseOrders.expectedDate,
      confirmedDate: purchaseOrders.confirmedDate,
      subtotal: purchaseOrders.subtotal,
      freight: purchaseOrders.freight,
      tax: purchaseOrders.tax,
      vendorName: vendors.name,
      vendorId: vendors.id,
      workOrderId: purchaseOrders.workOrderId,
      vendorRef: purchaseOrders.vendorRef,
    })
    .from(purchaseOrders)
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .where(and(...conds))
    .orderBy(desc(purchaseOrders.orderDate), desc(purchaseOrders.number));
}

/** Receiving log: every receipt line, newest first. */
export async function listReceipts(db: DbOrTx, orgId: string, limit = 200) {
  return db
    .select({
      receiptId: receipts.id,
      number: receipts.number,
      receivedAt: receipts.receivedAt,
      packingSlip: receipts.packingSlip,
      poId: purchaseOrders.id,
      poNumber: purchaseOrders.number,
      vendorName: vendors.name,
      sku: items.sku,
      itemName: items.name,
      qty: receiptLines.qty,
      unitCost: receiptLines.unitCost,
      lotNumber: receiptLines.lotNumber,
      inspectionStatus: receiptLines.inspectionStatus,
    })
    .from(receiptLines)
    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, receipts.poId))
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .innerJoin(items, eq(items.id, receiptLines.itemId))
    .where(eq(receipts.orgId, orgId))
    .orderBy(desc(receipts.receivedAt))
    .limit(limit);
}

// --- Vendor price list --------------------------------------------------------

export async function vendorPriceList(db: DbOrTx, orgId: string, vendorId: string) {
  return db
    .select({ vi: vendorItems, sku: items.sku, name: items.name, standardCost: items.standardCost })
    .from(vendorItems)
    .innerJoin(items, eq(items.id, vendorItems.itemId))
    .where(and(eq(vendorItems.orgId, orgId), eq(vendorItems.vendorId, vendorId)))
    .orderBy(asc(items.sku));
}

export async function vendorsForItem(db: DbOrTx, orgId: string, itemId: string) {
  return db
    .select({ vi: vendorItems, vendorName: vendors.name, vendorId: vendors.id, vendorLead: vendors.leadTimeDays })
    .from(vendorItems)
    .innerJoin(vendors, eq(vendors.id, vendorItems.vendorId))
    .where(and(eq(vendorItems.orgId, orgId), eq(vendorItems.itemId, itemId)))
    .orderBy(desc(vendorItems.preferred), asc(vendorItems.lastCost));
}

export async function upsertVendorItem(
  db: DbOrTx,
  actor: Actor,
  input: { vendorId: string; itemId: string; vendorPartNo?: string | null; lastCost?: number | null; leadTimeDays?: number | null; minQty?: number | null; preferred?: boolean },
) {
  await loadVendor(db, actor, input.vendorId);
  const [it] = await db.select({ id: items.id }).from(items).where(and(eq(items.id, input.itemId), eq(items.orgId, actor.orgId)));
  if (!it) throw new PurchasingError("Item not found");
  const values = {
    vendorPartNo: input.vendorPartNo?.trim() || null,
    lastCost: round4(Number(input.lastCost ?? 0)),
    leadTimeDays: input.leadTimeDays ?? null,
    minQty: Number(input.minQty ?? 0),
    preferred: !!input.preferred,
  };
  const [row] = await db
    .insert(vendorItems)
    .values({ orgId: actor.orgId, vendorId: input.vendorId, itemId: input.itemId, ...values })
    .onConflictDoUpdate({ target: [vendorItems.orgId, vendorItems.vendorId, vendorItems.itemId], set: { ...values, updatedAt: new Date() } })
    .returning();
  if (input.preferred) {
    await db.update(vendorItems).set({ preferred: false }).where(and(eq(vendorItems.orgId, actor.orgId), eq(vendorItems.itemId, input.itemId), ne(vendorItems.id, row.id)));
    await db.update(items).set({ preferredVendorId: input.vendorId, updatedAt: new Date() }).where(eq(items.id, input.itemId));
  }
  return row;
}

export async function deleteVendorItem(db: DbOrTx, actor: Actor, id: string) {
  await db.delete(vendorItems).where(and(eq(vendorItems.id, id), eq(vendorItems.orgId, actor.orgId)));
}

/** Plain-text email body for sending a PO; the shop pastes it into its mail client. */
export function poEmailText(po: typeof purchaseOrders.$inferSelect, vendor: typeof vendors.$inferSelect, lines: { lineNo: number; description: string; vendorPartNo: string | null; qty: number; unitCost: number; expectedDate: string | null }[], orgName: string) {
  const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const body = [
    `Hello ${vendor.name},`,
    "",
    `Please find our purchase order ${po.number}${po.revision > 1 ? ` rev ${po.revision}` : ""} below.`,
    "",
    ...lines.map((l) => `${l.lineNo}. ${l.description}${l.vendorPartNo ? ` (your p/n ${l.vendorPartNo})` : ""}: ${l.qty} @ ${fmt(l.unitCost)}${l.expectedDate ? `, need by ${l.expectedDate}` : ""}`),
    "",
    `Subtotal ${fmt(Number(po.subtotal))}${Number(po.freight) ? `, freight ${fmt(Number(po.freight))}` : ""}${Number(po.tax) ? `, tax ${fmt(Number(po.tax))}` : ""}. Terms net ${po.termsDays ?? vendor.termsDays}.${po.shipVia ? ` Ship via ${po.shipVia}.` : ""}`,
    po.notes ? `\n${po.notes}` : "",
    "",
    "Please confirm receipt and the delivery date.",
    "",
    orgName,
  ];
  return { subject: `Purchase order ${po.number} from ${orgName}`, body: body.join("\n") };
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
  safetyStock: number;
  suggestedQty: number;
  preferredVendorId: string | null;
  lastCost: number;
  leadTimeDays: number;
};

/**
 * What to buy: demand from open work orders and confirmed orders for buy
 * items, minus stock, minus open POs, topped up to the reorder quantity.
 * Safety stock raises the floor; the vendor price list supplies the cost.
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
      qty: sql<number>`coalesce(sum(${salesOrderLines.qty} - ${salesOrderLines.qtyShipped} - ${salesOrderLines.qtyCancelled}), 0)`.mapWith(Number),
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
    .innerJoin(items, eq(items.id, salesOrderLines.itemId))
    .where(and(eq(salesOrderLines.orgId, orgId), inArray(salesOrders.status, ["confirmed", "in_production", "partially_shipped"]), eq(items.type, "buy")))
    .groupBy(salesOrderLines.itemId);
  const onOrder = await db
    .select({
      itemId: purchaseOrderLines.itemId,
      qty: sql<number>`coalesce(sum(${purchaseOrderLines.qty} - ${purchaseOrderLines.qtyReceived} - ${purchaseOrderLines.qtyCancelled}), 0)`.mapWith(Number),
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.poId))
    .where(and(eq(purchaseOrderLines.orgId, orgId), inArray(purchaseOrders.status, [...PO_OPEN_STATUSES]), ne(purchaseOrders.status, "cancelled"), eq(purchaseOrderLines.lineType, "item")))
    .groupBy(purchaseOrderLines.itemId);
  const preferred = await db.select().from(vendorItems).where(and(eq(vendorItems.orgId, orgId), eq(vendorItems.preferred, true)));
  const all = await db.select().from(items).where(and(eq(items.orgId, orgId), eq(items.status, "active")));
  const out: Shortage[] = [];
  for (const it of all) {
    if (it.type === "make" || it.type === "phantom" || it.type === "service") continue;
    const onHand = onHandRows.find((r) => r.itemId === it.id)?.qty ?? 0;
    const demand = (woDemand.find((r) => r.itemId === it.id)?.qty ?? 0) + (soDemand.find((r) => r.itemId === it.id)?.qty ?? 0);
    const ordered = onOrder.find((r) => r.itemId === it.id)?.qty ?? 0;
    const available = onHand + ordered - demand;
    const floor = Math.max(Number(it.reorderPoint), Number(it.safetyStock));
    if (available < floor || available < 0) {
      const need = Math.max(floor - available, -available, 0);
      const suggested = round4(Math.max(need, Number(it.reorderQty), Number(it.minOrderQty)));
      const vp = preferred.find((p) => p.itemId === it.id);
      out.push({
        itemId: it.id,
        sku: it.sku,
        name: it.name,
        type: it.type,
        onHand: round4(onHand),
        demand: round4(demand),
        onOrder: round4(ordered),
        reorderPoint: Number(it.reorderPoint),
        reorderQty: Number(it.reorderQty),
        safetyStock: Number(it.safetyStock),
        suggestedQty: suggested,
        preferredVendorId: vp?.vendorId ?? it.preferredVendorId,
        lastCost: Number(vp?.lastCost) || Number(it.lastCost) || Number(it.standardCost),
        leadTimeDays: vp?.leadTimeDays ?? it.leadTimeDays,
      });
    }
  }
  return out.sort((a, b) => a.onHand - a.demand - (b.onHand - b.demand));
}

/** Open PO lines that are late against their expected date. */
export async function latePoLines(db: DbOrTx, orgId: string, asOf: string) {
  return db
    .select({ po: purchaseOrders, line: purchaseOrderLines, vendorName: vendors.name, sku: items.sku })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.poId))
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .leftJoin(items, eq(items.id, purchaseOrderLines.itemId))
    .where(
      and(
        eq(purchaseOrders.orgId, orgId),
        inArray(purchaseOrders.status, [...PO_OPEN_STATUSES]),
        eq(purchaseOrderLines.lineType, "item"),
        sql`${purchaseOrderLines.qty} - ${purchaseOrderLines.qtyReceived} - ${purchaseOrderLines.qtyCancelled} > 0`,
        or(isNull(purchaseOrderLines.expectedDate), sql`${purchaseOrderLines.expectedDate} < ${asOf}`)!,
      ),
    )
    .orderBy(asc(purchaseOrderLines.expectedDate));
}
