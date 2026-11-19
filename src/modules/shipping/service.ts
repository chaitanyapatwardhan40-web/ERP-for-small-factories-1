import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import {
  customerPaymentApplications,
  customerPayments,
  customers,
  invoiceLines,
  invoices,
  items,
  salesOrderLines,
  salesOrders,
  shipmentLines,
  shipments,
  vendorBills,
  vendors,
  type Address,
} from "@/lib/db/schema";
import { nextNumber } from "@/lib/numbering";
import { audit } from "@/lib/audit";
import { addDays, round4 } from "@/lib/money";
import { moveStock } from "@/modules/inventory/service";
import { postEvent, reverseSource } from "@/modules/books/service";
import { recomputeOrderStatus } from "@/modules/sales/service";

export class ShippingError extends Error {}
type Actor = { orgId: string; userId: string };
const today = () => new Date().toISOString().slice(0, 10);

export type ShipLine = { orderLineId: string; qty: number; locationId: string; lotNumber?: string | null };

/** Pack: a draft shipment that reserves nothing yet. Ship to post it. */
export async function createShipment(
  db: DbOrTx,
  actor: Actor,
  input: {
    orderId: string;
    carrier?: string | null;
    tracking?: string | null;
    notes?: string | null;
    packages?: number | null;
    weight?: number | null;
    freightCharge?: number | null;
    shipTo?: Address | null;
    lines: ShipLine[];
  },
) {
  const [order] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, input.orderId), eq(salesOrders.orgId, actor.orgId)));
  if (!order) throw new ShippingError("Order not found");
  if (["draft", "cancelled", "closed"].includes(order.status)) throw new ShippingError(`Order is ${order.status}`);
  if (order.holdReason) throw new ShippingError(`Order is on hold: ${order.holdReason}`);
  const lines = input.lines.filter((l) => Number(l.qty) > 0);
  if (!lines.length) throw new ShippingError("Nothing to ship");
  const orderLines = await db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id));
  const number = await nextNumber(db, actor.orgId, "shipment");
  const [sh] = await db
    .insert(shipments)
    .values({
      orgId: actor.orgId,
      number,
      orderId: order.id,
      customerId: order.customerId,
      carrier: input.carrier ?? order.shipVia ?? null,
      tracking: input.tracking ?? null,
      notes: input.notes ?? null,
      packages: Math.max(1, Math.round(Number(input.packages ?? 1))),
      weight: round4(Number(input.weight ?? 0)),
      freightCharge: round4(Number(input.freightCharge ?? 0)),
      shipTo: input.shipTo ?? order.shipTo ?? null,
    })
    .returning();
  for (const l of lines) {
    const ol = orderLines.find((o) => o.id === l.orderLineId);
    if (!ol) throw new ShippingError("Order line not found");
    const open = Number(ol.qty) - Number(ol.qtyShipped) - Number(ol.qtyCancelled);
    if (Number(l.qty) > open + 1e-9) throw new ShippingError(`Line ${ol.lineNo}: only ${open} open to ship`);
    await db.insert(shipmentLines).values({ orgId: actor.orgId, shipmentId: sh.id, orderLineId: ol.id, itemId: ol.itemId, qty: Number(l.qty), locationId: l.locationId, lotNumber: l.lotNumber ?? null });
  }
  await audit(db, { ...actor, action: "shipment.create", entityType: "shipment", entityId: sh.id });
  return sh;
}

/** Update carrier, tracking, packages and weight on a shipment (before or after shipping). */
export async function updateShipmentDetails(
  db: DbOrTx,
  actor: Actor,
  shipmentId: string,
  patch: { carrier?: string | null; tracking?: string | null; packages?: number | null; weight?: number | null; notes?: string | null; freightCharge?: number | null },
) {
  const [sh] = await db.select().from(shipments).where(and(eq(shipments.id, shipmentId), eq(shipments.orgId, actor.orgId)));
  if (!sh) throw new ShippingError("Shipment not found");
  if (sh.invoiceId && patch.freightCharge != null && Number(patch.freightCharge) !== Number(sh.freightCharge)) throw new ShippingError("Freight is already on the invoice");
  await db
    .update(shipments)
    .set({
      carrier: patch.carrier === undefined ? sh.carrier : patch.carrier,
      tracking: patch.tracking === undefined ? sh.tracking : patch.tracking,
      packages: patch.packages == null ? sh.packages : Math.max(1, Math.round(Number(patch.packages))),
      weight: patch.weight == null ? sh.weight : round4(Number(patch.weight)),
      notes: patch.notes === undefined ? sh.notes : patch.notes,
      freightCharge: patch.freightCharge == null ? sh.freightCharge : round4(Number(patch.freightCharge)),
      updatedAt: new Date(),
    })
    .where(eq(shipments.id, sh.id));
}

/** Ship: stock leaves at average cost, COGS / Inventory posts, the order advances. */
export async function shipShipment(db: DbOrTx, actor: Actor, shipmentId: string, opts: { shippedAt?: Date } = {}) {
  const [sh] = await db.select().from(shipments).where(and(eq(shipments.id, shipmentId), eq(shipments.orgId, actor.orgId)));
  if (!sh) throw new ShippingError("Shipment not found");
  if (sh.status === "shipped") throw new ShippingError("Already shipped");
  const lines = await db.select().from(shipmentLines).where(eq(shipmentLines.shipmentId, sh.id));
  const shippedAt = opts.shippedAt ?? new Date();
  for (const l of lines) {
    if (!l.locationId) throw new ShippingError("Shipment line has no location");
    await moveStock(db, {
      orgId: actor.orgId,
      userId: actor.userId,
      itemId: l.itemId,
      locationId: l.locationId,
      qty: -Number(l.qty),
      type: "ship",
      lotNumber: l.lotNumber,
      refType: "shipment",
      refId: sh.id,
      memo: `${sh.number}`,
      date: shippedAt.toISOString().slice(0, 10),
      glEvent: "sales.ship",
    });
    await db
      .update(salesOrderLines)
      .set({ qtyShipped: sql`${salesOrderLines.qtyShipped} + ${Number(l.qty)}`, updatedAt: new Date() })
      .where(eq(salesOrderLines.id, l.orderLineId));
  }
  await db.update(shipments).set({ status: "shipped", shippedAt, shippedBy: actor.userId, updatedAt: new Date() }).where(eq(shipments.id, sh.id));
  await recomputeOrderStatus(db, actor.orgId, sh.orderId);
  await audit(db, { ...actor, action: "shipment.ship", entityType: "shipment", entityId: sh.id });
}

/** Delete a draft shipment that was never shipped. */
export async function deleteDraftShipment(db: DbOrTx, actor: Actor, shipmentId: string) {
  const [sh] = await db.select().from(shipments).where(and(eq(shipments.id, shipmentId), eq(shipments.orgId, actor.orgId)));
  if (!sh) throw new ShippingError("Shipment not found");
  if (sh.status !== "draft") throw new ShippingError("Only draft shipments can be deleted");
  await db.delete(shipments).where(eq(shipments.id, sh.id));
  await audit(db, { ...actor, action: "shipment.delete", entityType: "shipment", entityId: sh.id });
}

/** Ship everything open on an order from one location in a single step. */
export async function shipOrderInFull(
  db: DbOrTx,
  actor: Actor,
  orderId: string,
  locationId: string,
  extra: { carrier?: string | null; tracking?: string | null; shippedAt?: Date; packages?: number | null; weight?: number | null; freightCharge?: number | null } = {},
) {
  const orderLines = await db.select().from(salesOrderLines).where(and(eq(salesOrderLines.orderId, orderId), eq(salesOrderLines.orgId, actor.orgId)));
  const lines = orderLines
    .map((l) => ({ orderLineId: l.id, qty: round4(Number(l.qty) - Number(l.qtyShipped) - Number(l.qtyCancelled)), locationId }))
    .filter((l) => l.qty > 0);
  const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId));
  const sh = await createShipment(db, actor, { orderId, lines, carrier: extra.carrier, tracking: extra.tracking, packages: extra.packages, weight: extra.weight, freightCharge: extra.freightCharge ?? (order ? Number(order.freight) : 0) });
  await shipShipment(db, actor, sh.id, { shippedAt: extra.shippedAt });
  return sh;
}

/**
 * Invoice a shipment at the order's prices, less line and order discounts,
 * plus the shipment's freight charge. Posts AR / Revenue (+ tax).
 */
export async function createInvoiceFromShipment(
  db: DbOrTx,
  actor: Actor,
  input: { shipmentId: string; issueDate?: string; dueDate?: string | null; taxRatePct?: number; memo?: string | null },
) {
  const [sh] = await db.select().from(shipments).where(and(eq(shipments.id, input.shipmentId), eq(shipments.orgId, actor.orgId)));
  if (!sh) throw new ShippingError("Shipment not found");
  if (sh.status !== "shipped") throw new ShippingError("Ship before invoicing");
  if (sh.invoiceId) throw new ShippingError("Shipment already invoiced");
  const [customer] = await db.select().from(customers).where(eq(customers.id, sh.customerId));
  const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, sh.orderId));
  const lines = await db
    .select({ sl: shipmentLines, ol: salesOrderLines, itemName: items.name })
    .from(shipmentLines)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, shipmentLines.orderLineId))
    .innerJoin(items, eq(items.id, shipmentLines.itemId))
    .where(eq(shipmentLines.shipmentId, sh.id));
  const issueDate = input.issueDate ?? today();
  const taxRate = customer?.taxExempt ? 0 : Number(input.taxRatePct ?? 0);
  const orderDisc = Number(order?.discountPct ?? 0);
  const lineRows = lines.map((l) => {
    const unit = round4(Number(l.ol.unitPrice) * (1 - Number(l.ol.discountPct) / 100) * (1 - orderDisc / 100));
    return { ...l, unit, amount: round4(Number(l.sl.qty) * unit) };
  });
  const goods = round4(lineRows.reduce((s, l) => s + l.amount, 0));
  const freight = round4(Number(sh.freightCharge));
  const subtotal = round4(goods + freight);
  const tax = round4((goods * taxRate) / 100);
  const number = await nextNumber(db, actor.orgId, "invoice");
  const termsDays = order?.termsDays ?? customer?.termsDays ?? 30;
  const [inv] = await db
    .insert(invoices)
    .values({
      orgId: actor.orgId,
      number,
      customerId: sh.customerId,
      orderId: sh.orderId,
      shipmentId: sh.id,
      status: "issued",
      issueDate,
      dueDate: input.dueDate ?? addDays(issueDate, termsDays),
      subtotal,
      freight,
      taxRatePct: taxRate,
      tax,
      total: round4(subtotal + tax),
      termsDays,
      memo: input.memo ?? null,
    })
    .returning();
  let n = 1;
  for (const l of lineRows) {
    await db.insert(invoiceLines).values({
      orgId: actor.orgId,
      invoiceId: inv.id,
      lineNo: n++,
      itemId: l.sl.itemId,
      description: l.ol.description || l.itemName,
      qty: Number(l.sl.qty),
      unitPrice: l.unit,
      amount: l.amount,
    });
    await db
      .update(salesOrderLines)
      .set({ qtyInvoiced: sql`${salesOrderLines.qtyInvoiced} + ${Number(l.sl.qty)}` })
      .where(eq(salesOrderLines.id, l.ol.id));
  }
  if (freight > 0) {
    await db.insert(invoiceLines).values({ orgId: actor.orgId, invoiceId: inv.id, lineNo: n++, itemId: null, description: "Freight", qty: 1, unitPrice: freight, amount: freight });
  }
  await postEvent(db, { orgId: actor.orgId, event: "sales.invoice", amount: subtotal, date: issueDate, memo: `${inv.number} ${customer?.name ?? ""}`, sourceType: "invoice", sourceId: inv.id });
  if (tax > 0) await postEvent(db, { orgId: actor.orgId, event: "sales.tax", amount: tax, date: issueDate, memo: `${inv.number} sales tax`, sourceType: "invoice", sourceId: inv.id });
  await db.update(shipments).set({ invoiceId: inv.id }).where(eq(shipments.id, sh.id));
  await recomputeOrderStatus(db, actor.orgId, sh.orderId);
  await audit(db, { ...actor, action: "invoice.issue", entityType: "invoice", entityId: inv.id });
  return inv;
}

/**
 * Credit memo against an invoice: negative receivable that reduces the
 * invoice's open balance (or sits as customer credit if it is already paid).
 */
export async function createCreditMemo(
  db: DbOrTx,
  actor: Actor,
  input: { invoiceId: string; amount: number; reason: string; issueDate?: string; restock?: { itemId: string; qty: number; locationId: string }[] },
) {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.orgId, actor.orgId)));
  if (!inv) throw new ShippingError("Invoice not found");
  if (inv.kind !== "invoice" || inv.status === "void") throw new ShippingError("Credit memos apply to issued invoices");
  const amount = round4(Number(input.amount));
  if (amount <= 0) throw new ShippingError("Amount must be positive");
  const credited = await db
    .select({ s: sql<number>`coalesce(sum(${invoices.total}), 0)`.mapWith(Number) })
    .from(invoices)
    .where(and(eq(invoices.creditOfInvoiceId, inv.id), eq(invoices.kind, "credit_memo"), sql`${invoices.status} <> 'void'`));
  if (amount > Number(inv.total) - (credited[0]?.s ?? 0) + 1e-9) throw new ShippingError("Credit exceeds the invoice total");
  const issueDate = input.issueDate ?? today();
  const number = await nextNumber(db, actor.orgId, "credit");
  const [cm] = await db
    .insert(invoices)
    .values({
      orgId: actor.orgId,
      number,
      customerId: inv.customerId,
      orderId: inv.orderId,
      kind: "credit_memo",
      creditOfInvoiceId: inv.id,
      status: "paid",
      issueDate,
      dueDate: issueDate,
      subtotal: amount,
      total: amount,
      amountPaid: amount,
      memo: input.reason,
    })
    .returning();
  await db.insert(invoiceLines).values({ orgId: actor.orgId, invoiceId: cm.id, lineNo: 1, description: `Credit against ${inv.number}: ${input.reason}`, qty: 1, unitPrice: amount, amount });
  // Revenue comes back, receivable goes down.
  await postEvent(db, { orgId: actor.orgId, event: "sales.credit_memo", amount, date: issueDate, memo: `${cm.number} credit for ${inv.number}`, sourceType: "invoice", sourceId: cm.id });
  const open = round4(Number(inv.total) - Number(inv.amountPaid));
  const applied = Math.min(open, amount);
  if (applied > 0) {
    const paid = round4(Number(inv.amountPaid) + applied);
    await db.update(invoices).set({ amountPaid: paid, status: paid >= Number(inv.total) - 1e-9 ? "paid" : "issued", updatedAt: new Date() }).where(eq(invoices.id, inv.id));
  }
  for (const r of input.restock ?? []) {
    if (!(Number(r.qty) > 0)) continue;
    const [it] = await db.select({ avgCost: items.avgCost }).from(items).where(eq(items.id, r.itemId));
    await moveStock(db, {
      orgId: actor.orgId,
      userId: actor.userId,
      itemId: r.itemId,
      locationId: r.locationId,
      qty: Number(r.qty),
      unitCost: Number(it?.avgCost ?? 0),
      type: "return",
      refType: "invoice",
      refId: cm.id,
      memo: `${cm.number} customer return`,
      date: issueDate,
      glEvent: "sales.return",
    });
  }
  await audit(db, { ...actor, action: "invoice.credit", entityType: "invoice", entityId: inv.id, data: { creditMemoId: cm.id, amount } });
  return cm;
}

/** Void an unpaid invoice: reverses its postings and reopens the shipped quantities for re-invoicing. */
export async function voidInvoice(db: DbOrTx, actor: Actor, invoiceId: string, reason: string) {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, actor.orgId)));
  if (!inv) throw new ShippingError("Invoice not found");
  if (inv.status === "void") return inv;
  if (Number(inv.amountPaid) > 0) throw new ShippingError("An invoice with payments cannot be voided; issue a credit memo");
  await reverseSource(db, actor, "invoice", inv.id, `Void ${inv.number}: ${reason}`);
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
  if (inv.shipmentId) {
    const shLines = await db.select().from(shipmentLines).where(eq(shipmentLines.shipmentId, inv.shipmentId));
    for (const l of shLines) {
      await db.update(salesOrderLines).set({ qtyInvoiced: sql`greatest(${salesOrderLines.qtyInvoiced} - ${Number(l.qty)}, 0)` }).where(eq(salesOrderLines.id, l.orderLineId));
    }
    await db.update(shipments).set({ invoiceId: null }).where(eq(shipments.id, inv.shipmentId));
  }
  void lines;
  await db.update(invoices).set({ status: "void", memo: [inv.memo, `Void: ${reason}`].filter(Boolean).join("\n"), updatedAt: new Date() }).where(eq(invoices.id, inv.id));
  if (inv.orderId) await recomputeOrderStatus(db, actor.orgId, inv.orderId);
  await audit(db, { ...actor, action: "invoice.void", entityType: "invoice", entityId: inv.id, data: { reason } });
  return inv;
}

export type PaymentApplication = { invoiceId: string; amount: number };

/**
 * A customer payment applied to one or more invoices. Anything left over is
 * held as unapplied credit on the customer.
 */
export async function recordCustomerPayment(
  db: DbOrTx,
  actor: Actor,
  input: {
    invoiceId?: string;
    customerId?: string;
    amount: number;
    paidAt: string;
    method?: "check" | "ach" | "card" | "cash" | "other";
    reference?: string | null;
    memo?: string | null;
    applications?: PaymentApplication[];
  },
) {
  const amount = round4(Number(input.amount));
  if (amount <= 0) throw new ShippingError("Amount must be positive");
  let apps: PaymentApplication[] = (input.applications ?? []).filter((a) => Number(a.amount) > 0);
  if (!apps.length && input.invoiceId) apps = [{ invoiceId: input.invoiceId, amount }];
  const invIds = apps.map((a) => a.invoiceId);
  const invs = invIds.length ? await db.select().from(invoices).where(and(eq(invoices.orgId, actor.orgId), inArray(invoices.id, invIds))) : [];
  const customerId = input.customerId ?? invs[0]?.customerId;
  if (!customerId) throw new ShippingError("Pick a customer or an invoice");
  let applied = 0;
  for (const a of apps) {
    const inv = invs.find((i) => i.id === a.invoiceId);
    if (!inv) throw new ShippingError("Invoice not found");
    if (inv.customerId !== customerId) throw new ShippingError(`${inv.number} belongs to another customer`);
    if (inv.status === "void" || inv.status === "draft") throw new ShippingError(`${inv.number} is ${inv.status}`);
    const open = round4(Number(inv.total) - Number(inv.amountPaid));
    if (Number(a.amount) > open + 1e-9) throw new ShippingError(`${inv.number}: only ${open} open`);
    applied = round4(applied + Number(a.amount));
  }
  if (applied > amount + 1e-9) throw new ShippingError(`Applied ${applied} exceeds the payment of ${amount}`);
  const number = await nextNumber(db, actor.orgId, "payment");
  const [pay] = await db
    .insert(customerPayments)
    .values({
      orgId: actor.orgId,
      number,
      customerId,
      invoiceId: apps.length === 1 ? apps[0].invoiceId : null,
      amount,
      paidAt: input.paidAt,
      method: input.method ?? "check",
      reference: input.reference ?? null,
      memo: input.memo ?? null,
      unapplied: round4(amount - applied),
    })
    .returning();
  for (const a of apps) {
    const inv = invs.find((i) => i.id === a.invoiceId)!;
    await db.insert(customerPaymentApplications).values({ orgId: actor.orgId, paymentId: pay.id, invoiceId: inv.id, amount: round4(Number(a.amount)) });
    const paid = round4(Number(inv.amountPaid) + Number(a.amount));
    await db.update(invoices).set({ amountPaid: paid, status: paid >= Number(inv.total) - 1e-9 ? "paid" : "issued", updatedAt: new Date() }).where(eq(invoices.id, inv.id));
    inv.amountPaid = paid;
  }
  await postEvent(db, { orgId: actor.orgId, event: "sales.payment", amount, date: input.paidAt, memo: `${pay.number}${apps.length ? ` for ${invs.map((i) => i.number).join(", ")}` : " on account"}`, sourceType: "customer_payment", sourceId: pay.id });
  await audit(db, { ...actor, action: "payment.record", entityType: "customer_payment", entityId: pay.id, data: { amount, applied } });
  return pay;
}

/** Apply unapplied credit from an earlier payment to an invoice. */
export async function applyUnappliedPayment(db: DbOrTx, actor: Actor, paymentId: string, invoiceId: string, amount: number) {
  const [pay] = await db.select().from(customerPayments).where(and(eq(customerPayments.id, paymentId), eq(customerPayments.orgId, actor.orgId)));
  if (!pay) throw new ShippingError("Payment not found");
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, actor.orgId)));
  if (!inv) throw new ShippingError("Invoice not found");
  if (inv.customerId !== pay.customerId) throw new ShippingError("Invoice belongs to another customer");
  const amt = round4(Number(amount));
  const open = round4(Number(inv.total) - Number(inv.amountPaid));
  if (amt <= 0 || amt > Number(pay.unapplied) + 1e-9 || amt > open + 1e-9) throw new ShippingError(`Apply between 0 and ${Math.min(Number(pay.unapplied), open)}`);
  await db.insert(customerPaymentApplications).values({ orgId: actor.orgId, paymentId: pay.id, invoiceId: inv.id, amount: amt });
  const paid = round4(Number(inv.amountPaid) + amt);
  await db.update(invoices).set({ amountPaid: paid, status: paid >= Number(inv.total) - 1e-9 ? "paid" : "issued", updatedAt: new Date() }).where(eq(invoices.id, inv.id));
  await db.update(customerPayments).set({ unapplied: round4(Number(pay.unapplied) - amt), updatedAt: new Date() }).where(eq(customerPayments.id, pay.id));
}

export async function openInvoicesForCustomer(db: DbOrTx, orgId: string, customerId: string) {
  const rows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.customerId, customerId), eq(invoices.status, "issued")))
    .orderBy(asc(invoices.dueDate));
  return rows.map((r) => ({ ...r, open: round4(Number(r.total) - Number(r.amountPaid)) })).filter((r) => r.open > 0);
}

export async function unappliedPayments(db: DbOrTx, orgId: string, customerId: string) {
  return db
    .select()
    .from(customerPayments)
    .where(and(eq(customerPayments.orgId, orgId), eq(customerPayments.customerId, customerId), sql`${customerPayments.unapplied} > 0`))
    .orderBy(asc(customerPayments.paidAt));
}

/** Everything open for a customer statement: invoices, credits and unapplied cash. */
export async function customerStatement(db: DbOrTx, orgId: string, customerId: string, asOf = today()) {
  const invs = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.customerId, customerId), sql`${invoices.status} <> 'void'`, sql`${invoices.issueDate} <= ${asOf}`))
    .orderBy(asc(invoices.issueDate), asc(invoices.number));
  const pays = await db
    .select()
    .from(customerPayments)
    .where(and(eq(customerPayments.orgId, orgId), eq(customerPayments.customerId, customerId), sql`${customerPayments.paidAt} <= ${asOf}`))
    .orderBy(asc(customerPayments.paidAt));
  const lines: { date: string; ref: string; description: string; charge: number; credit: number }[] = [];
  for (const i of invs) {
    if (i.kind === "credit_memo") lines.push({ date: i.issueDate, ref: i.number, description: i.memo ?? "Credit memo", charge: 0, credit: Number(i.total) });
    else lines.push({ date: i.issueDate, ref: i.number, description: `Invoice${i.dueDate ? `, due ${i.dueDate}` : ""}`, charge: Number(i.total), credit: 0 });
  }
  for (const p of pays) lines.push({ date: p.paidAt, ref: p.number, description: `Payment${p.reference ? ` ${p.reference}` : ""} (${p.method})`, charge: 0, credit: Number(p.amount) });
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
  let balance = 0;
  const rows = lines.map((l) => {
    balance = round4(balance + l.charge - l.credit);
    return { ...l, balance };
  });
  const open = invs.filter((i) => i.kind === "invoice" && i.status === "issued").map((i) => ({ number: i.number, dueDate: i.dueDate, open: round4(Number(i.total) - Number(i.amountPaid)) }));
  const unapplied = pays.reduce((s, p) => s + Number(p.unapplied), 0);
  return { rows, open, unapplied: round4(unapplied), balance: round4(open.reduce((s, o) => s + o.open, 0) - unapplied) };
}

export type AgingBucket = { current: number; d1_30: number; d31_60: number; d61_90: number; over90: number; total: number };

function bucketize<T extends { dueDate: string; open: number }>(rows: T[], asOf: string) {
  const asOfMs = new Date(`${asOf}T00:00:00`).getTime();
  const out: AgingBucket = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0, total: 0 };
  for (const r of rows) {
    const days = Math.floor((asOfMs - new Date(`${r.dueDate}T00:00:00`).getTime()) / 86_400_000);
    const v = r.open;
    out.total += v;
    if (days <= 0) out.current += v;
    else if (days <= 30) out.d1_30 += v;
    else if (days <= 60) out.d31_60 += v;
    else if (days <= 90) out.d61_90 += v;
    else out.over90 += v;
  }
  for (const k of Object.keys(out) as (keyof AgingBucket)[]) out[k] = round4(out[k]);
  return out;
}

export async function arAging(db: DbOrTx, orgId: string, asOf = today()) {
  const rows = await db
    .select({ id: invoices.id, number: invoices.number, dueDate: invoices.dueDate, total: invoices.total, amountPaid: invoices.amountPaid, customerName: customers.name, customerId: customers.id })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(and(eq(invoices.orgId, orgId), eq(invoices.status, "issued"), eq(invoices.kind, "invoice")))
    .orderBy(asc(invoices.dueDate));
  const open = rows.map((r) => ({ ...r, open: round4(Number(r.total) - Number(r.amountPaid)) })).filter((r) => r.open > 0);
  return { rows: open, buckets: bucketize(open, asOf) };
}

export async function apAging(db: DbOrTx, orgId: string, asOf = today()) {
  const rows = await db
    .select({ id: vendorBills.id, number: vendorBills.number, dueDate: vendorBills.dueDate, total: vendorBills.total, amountPaid: vendorBills.amountPaid, vendorName: vendors.name })
    .from(vendorBills)
    .innerJoin(vendors, eq(vendors.id, vendorBills.vendorId))
    .where(and(eq(vendorBills.orgId, orgId), inArray(vendorBills.status, ["approved", "draft"])))
    .orderBy(asc(vendorBills.dueDate));
  const open = rows.map((r) => ({ ...r, open: round4(Number(r.total) - Number(r.amountPaid)) })).filter((r) => r.open > 0);
  return { rows: open, buckets: bucketize(open, asOf) };
}

export async function listShipments(db: DbOrTx, orgId: string) {
  return db
    .select({
      id: shipments.id,
      number: shipments.number,
      status: shipments.status,
      shippedAt: shipments.shippedAt,
      carrier: shipments.carrier,
      tracking: shipments.tracking,
      packages: shipments.packages,
      weight: shipments.weight,
      invoiceId: shipments.invoiceId,
      orderNumber: salesOrders.number,
      orderId: salesOrders.id,
      customerName: customers.name,
    })
    .from(shipments)
    .innerJoin(salesOrders, eq(salesOrders.id, shipments.orderId))
    .innerJoin(customers, eq(customers.id, shipments.customerId))
    .where(eq(shipments.orgId, orgId))
    .orderBy(desc(shipments.createdAt));
}
