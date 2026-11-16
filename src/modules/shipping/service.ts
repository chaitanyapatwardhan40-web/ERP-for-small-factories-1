import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import {
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
} from "@/lib/db/schema";
import { nextNumber } from "@/lib/numbering";
import { audit } from "@/lib/audit";
import { addDays, round4 } from "@/lib/money";
import { moveStock } from "@/modules/inventory/service";
import { postEvent } from "@/modules/books/service";
import { recomputeOrderStatus } from "@/modules/sales/service";

export class ShippingError extends Error {}
type Actor = { orgId: string; userId: string };
const today = () => new Date().toISOString().slice(0, 10);

export type ShipLine = { orderLineId: string; qty: number; locationId: string; lotNumber?: string | null };

/** Pack: a draft shipment that reserves nothing yet. Ship to post it. */
export async function createShipment(
  db: DbOrTx,
  actor: Actor,
  input: { orderId: string; carrier?: string | null; tracking?: string | null; notes?: string | null; lines: ShipLine[] },
) {
  const [order] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, input.orderId), eq(salesOrders.orgId, actor.orgId)));
  if (!order) throw new ShippingError("Order not found");
  if (["draft", "cancelled", "closed"].includes(order.status)) throw new ShippingError(`Order is ${order.status}`);
  const lines = input.lines.filter((l) => Number(l.qty) > 0);
  if (!lines.length) throw new ShippingError("Nothing to ship");
  const orderLines = await db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id));
  const number = await nextNumber(db, actor.orgId, "shipment");
  const [sh] = await db
    .insert(shipments)
    .values({ orgId: actor.orgId, number, orderId: order.id, customerId: order.customerId, carrier: input.carrier ?? null, tracking: input.tracking ?? null, notes: input.notes ?? null })
    .returning();
  for (const l of lines) {
    const ol = orderLines.find((o) => o.id === l.orderLineId);
    if (!ol) throw new ShippingError("Order line not found");
    const open = Number(ol.qty) - Number(ol.qtyShipped);
    if (Number(l.qty) > open + 1e-9) throw new ShippingError(`Line ${ol.lineNo}: only ${open} open to ship`);
    await db.insert(shipmentLines).values({ orgId: actor.orgId, shipmentId: sh.id, orderLineId: ol.id, itemId: ol.itemId, qty: Number(l.qty), locationId: l.locationId, lotNumber: l.lotNumber ?? null });
  }
  return sh;
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

/** Ship everything open on an order from one location in a single step. */
export async function shipOrderInFull(db: DbOrTx, actor: Actor, orderId: string, locationId: string, extra: { carrier?: string | null; tracking?: string | null; shippedAt?: Date } = {}) {
  const orderLines = await db.select().from(salesOrderLines).where(and(eq(salesOrderLines.orderId, orderId), eq(salesOrderLines.orgId, actor.orgId)));
  const lines = orderLines
    .map((l) => ({ orderLineId: l.id, qty: round4(Number(l.qty) - Number(l.qtyShipped)), locationId }))
    .filter((l) => l.qty > 0);
  const sh = await createShipment(db, actor, { orderId, lines, carrier: extra.carrier, tracking: extra.tracking });
  await shipShipment(db, actor, sh.id, { shippedAt: extra.shippedAt });
  return sh;
}

/** Invoice a shipment at the order's prices. Posts AR / Revenue (+ tax). */
export async function createInvoiceFromShipment(
  db: DbOrTx,
  actor: Actor,
  input: { shipmentId: string; issueDate?: string; dueDate?: string | null; taxRatePct?: number },
) {
  const [sh] = await db.select().from(shipments).where(and(eq(shipments.id, input.shipmentId), eq(shipments.orgId, actor.orgId)));
  if (!sh) throw new ShippingError("Shipment not found");
  if (sh.status !== "shipped") throw new ShippingError("Ship before invoicing");
  if (sh.invoiceId) throw new ShippingError("Shipment already invoiced");
  const [customer] = await db.select().from(customers).where(eq(customers.id, sh.customerId));
  const lines = await db
    .select({ sl: shipmentLines, ol: salesOrderLines, itemName: items.name })
    .from(shipmentLines)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, shipmentLines.orderLineId))
    .innerJoin(items, eq(items.id, shipmentLines.itemId))
    .where(eq(shipmentLines.shipmentId, sh.id));
  const issueDate = input.issueDate ?? today();
  const taxRate = customer?.taxExempt ? 0 : Number(input.taxRatePct ?? 0);
  const subtotal = round4(lines.reduce((s, l) => s + Number(l.sl.qty) * Number(l.ol.unitPrice), 0));
  const tax = round4((subtotal * taxRate) / 100);
  const number = await nextNumber(db, actor.orgId, "invoice");
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
      dueDate: input.dueDate ?? addDays(issueDate, customer?.termsDays ?? 30),
      subtotal,
      taxRatePct: taxRate,
      tax,
      total: round4(subtotal + tax),
    })
    .returning();
  let n = 1;
  for (const l of lines) {
    await db.insert(invoiceLines).values({
      orgId: actor.orgId,
      invoiceId: inv.id,
      lineNo: n++,
      itemId: l.sl.itemId,
      description: l.ol.description || l.itemName,
      qty: Number(l.sl.qty),
      unitPrice: Number(l.ol.unitPrice),
      amount: round4(Number(l.sl.qty) * Number(l.ol.unitPrice)),
    });
    await db
      .update(salesOrderLines)
      .set({ qtyInvoiced: sql`${salesOrderLines.qtyInvoiced} + ${Number(l.sl.qty)}` })
      .where(eq(salesOrderLines.id, l.ol.id));
  }
  await postEvent(db, { orgId: actor.orgId, event: "sales.invoice", amount: subtotal, date: issueDate, memo: `${inv.number} ${customer?.name ?? ""}`, sourceType: "invoice", sourceId: inv.id });
  if (tax > 0) await postEvent(db, { orgId: actor.orgId, event: "sales.tax", amount: tax, date: issueDate, memo: `${inv.number} sales tax`, sourceType: "invoice", sourceId: inv.id });
  await db.update(shipments).set({ invoiceId: inv.id }).where(eq(shipments.id, sh.id));
  await recomputeOrderStatus(db, actor.orgId, sh.orderId);
  await audit(db, { ...actor, action: "invoice.issue", entityType: "invoice", entityId: inv.id });
  return inv;
}

export async function recordCustomerPayment(
  db: DbOrTx,
  actor: Actor,
  input: { invoiceId: string; amount: number; paidAt: string; method?: "check" | "ach" | "card" | "cash" | "other"; reference?: string | null },
) {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.orgId, actor.orgId)));
  if (!inv) throw new ShippingError("Invoice not found");
  if (inv.status === "void" || inv.status === "draft") throw new ShippingError(`Invoice is ${inv.status}`);
  const amount = round4(Number(input.amount));
  const open = round4(Number(inv.total) - Number(inv.amountPaid));
  if (amount <= 0 || amount > open + 1e-9) throw new ShippingError(`Payment must be between 0 and ${open}`);
  const number = await nextNumber(db, actor.orgId, "payment");
  const [pay] = await db
    .insert(customerPayments)
    .values({ orgId: actor.orgId, number, customerId: inv.customerId, invoiceId: inv.id, amount, paidAt: input.paidAt, method: input.method ?? "check", reference: input.reference ?? null })
    .returning();
  await postEvent(db, { orgId: actor.orgId, event: "sales.payment", amount, date: input.paidAt, memo: `${pay.number} for ${inv.number}`, sourceType: "customer_payment", sourceId: pay.id });
  const paid = round4(Number(inv.amountPaid) + amount);
  await db.update(invoices).set({ amountPaid: paid, status: paid >= Number(inv.total) - 1e-9 ? "paid" : "issued", updatedAt: new Date() }).where(eq(invoices.id, inv.id));
  return pay;
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
    .select({ id: invoices.id, number: invoices.number, dueDate: invoices.dueDate, total: invoices.total, amountPaid: invoices.amountPaid, customerName: customers.name })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(and(eq(invoices.orgId, orgId), eq(invoices.status, "issued")))
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
