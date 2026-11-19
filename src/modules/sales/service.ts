import { and, asc, desc, eq, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import {
  customerPrices,
  customers,
  invoices,
  items,
  orderChanges,
  quoteLines,
  quotes,
  salesOrderLines,
  salesOrders,
  type Address,
  type QUOTE_STATUSES,
} from "@/lib/db/schema";
import { nextNumber } from "@/lib/numbering";
import { audit } from "@/lib/audit";
import { round4 } from "@/lib/money";
import { rollUpCost } from "@/modules/items/service";

export class SalesError extends Error {}

type Actor = { orgId: string; userId: string };

export type QuoteLineInput = {
  itemId?: string | null;
  description: string;
  qty: number;
  materialCost?: number;
  laborCost?: number;
  outsideCost?: number;
  overheadCost?: number;
  marginPct?: number;
  unitPrice?: number;
  leadTimeDays?: number;
  discountPct?: number | null;
  notes?: string | null;
};

/** Price = cost / (1 - margin). A 30% margin on $70 cost is $100. */
export function priceFromCost(line: QuoteLineInput): number {
  const cost =
    Number(line.materialCost ?? 0) +
    Number(line.laborCost ?? 0) +
    Number(line.outsideCost ?? 0) +
    Number(line.overheadCost ?? 0);
  const margin = Math.min(99, Math.max(0, Number(line.marginPct ?? 0)));
  if (cost === 0) return round4(Number(line.unitPrice ?? 0));
  return round4(cost / (1 - margin / 100));
}

/** Extended amount of a line after its discount. */
export function lineAmount(qty: number, unitPrice: number, discountPct = 0) {
  return round4(Number(qty) * Number(unitPrice) * (1 - Math.min(100, Math.max(0, Number(discountPct))) / 100));
}

/** Cost build-up for an item from its BOM and routing, for a quote line prefill. */
export async function estimateLine(db: DbOrTx, orgId: string, itemId: string, qty: number, overheadPct: number) {
  const cost = await rollUpCost(db, orgId, itemId, { overheadPct }, Math.max(1, qty));
  return {
    materialCost: cost.material,
    laborCost: cost.labor,
    outsideCost: cost.outside,
    overheadCost: cost.overhead,
  };
}

/**
 * The price to charge a customer for an item: their own price list (best
 * quantity break that is valid today), then the general price list, then the
 * item's list price.
 */
export async function resolveSalesPrice(db: DbOrTx, orgId: string, customerId: string | null, itemId: string, qty: number, date: string): Promise<number | null> {
  const rows = await db
    .select()
    .from(customerPrices)
    .where(
      and(
        eq(customerPrices.orgId, orgId),
        eq(customerPrices.itemId, itemId),
        customerId ? or(eq(customerPrices.customerId, customerId), isNull(customerPrices.customerId))! : isNull(customerPrices.customerId),
        lte(customerPrices.minQty, qty),
        or(isNull(customerPrices.validFrom), sql`${customerPrices.validFrom} <= ${date}`)!,
        or(isNull(customerPrices.validTo), sql`${customerPrices.validTo} >= ${date}`)!,
      ),
    );
  const pick = (list: typeof rows) => list.sort((a, b) => Number(b.minQty) - Number(a.minQty))[0];
  const own = customerId ? pick(rows.filter((r) => r.customerId === customerId)) : undefined;
  const general = pick(rows.filter((r) => !r.customerId));
  const hit = own ?? general;
  if (hit) return Number(hit.unitPrice);
  const [it] = await db.select({ salesPrice: items.salesPrice }).from(items).where(eq(items.id, itemId));
  return it ? Number(it.salesPrice) : null;
}

/** Price hints for a line editor: every item that has a price-list entry for this customer. */
export async function priceHintsFor(db: DbOrTx, orgId: string, customerId: string | null, date: string) {
  const rows = await db
    .select()
    .from(customerPrices)
    .where(and(eq(customerPrices.orgId, orgId), customerId ? or(eq(customerPrices.customerId, customerId), isNull(customerPrices.customerId))! : isNull(customerPrices.customerId)));
  const out: Record<string, { price: number }> = {};
  for (const r of rows) {
    if (r.validFrom && r.validFrom > date) continue;
    if (r.validTo && r.validTo < date) continue;
    if (Number(r.minQty) > 1) continue;
    const existing = out[r.itemId];
    if (!existing || (r.customerId && customerId)) out[r.itemId] = { price: Number(r.unitPrice) };
  }
  return out;
}

export async function createQuote(
  db: DbOrTx,
  actor: Actor,
  input: {
    customerId: string;
    quoteDate: string;
    validUntil?: string | null;
    customerRfq?: string | null;
    contactName?: string | null;
    terms?: string | null;
    discountPct?: number | null;
    notes?: string | null;
    lines: QuoteLineInput[];
  },
) {
  if (!input.lines.length) throw new SalesError("A quote needs at least one line");
  const number = await nextNumber(db, actor.orgId, "quote");
  const [quote] = await db
    .insert(quotes)
    .values({
      orgId: actor.orgId,
      number,
      customerId: input.customerId,
      quoteDate: input.quoteDate,
      validUntil: input.validUntil ?? null,
      customerRfq: input.customerRfq ?? null,
      contactName: input.contactName ?? null,
      terms: input.terms ?? null,
      discountPct: Number(input.discountPct ?? 0),
      notes: input.notes ?? null,
    })
    .returning();
  await replaceQuoteLines(db, actor, quote.id, input.lines);
  await audit(db, { ...actor, action: "quote.create", entityType: "quote", entityId: quote.id });
  return quote;
}

/** Edit a quote; a sent quote becomes the next revision. */
export async function updateQuote(
  db: DbOrTx,
  actor: Actor,
  quoteId: string,
  input: { customerId: string; quoteDate: string; validUntil?: string | null; customerRfq?: string | null; contactName?: string | null; terms?: string | null; discountPct?: number | null; notes?: string | null; lines: QuoteLineInput[] },
) {
  const [q] = await db.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.orgId, actor.orgId)));
  if (!q) throw new SalesError("Quote not found");
  if (q.status === "accepted") throw new SalesError("An accepted quote cannot be edited; change the sales order");
  if (!input.lines.length) throw new SalesError("A quote needs at least one line");
  const revision = q.status === "draft" ? q.revision : q.revision + 1;
  await db
    .update(quotes)
    .set({
      customerId: input.customerId,
      quoteDate: input.quoteDate,
      validUntil: input.validUntil ?? null,
      customerRfq: input.customerRfq ?? null,
      contactName: input.contactName ?? null,
      terms: input.terms ?? null,
      discountPct: Number(input.discountPct ?? 0),
      notes: input.notes ?? null,
      revision,
      status: q.status === "expired" || q.status === "lost" ? "draft" : q.status,
      updatedAt: new Date(),
    })
    .where(eq(quotes.id, quoteId));
  await replaceQuoteLines(db, actor, quoteId, input.lines);
  await audit(db, { ...actor, action: "quote.update", entityType: "quote", entityId: quoteId, data: { revision } });
}

export async function replaceQuoteLines(db: DbOrTx, actor: Actor, quoteId: string, lines: QuoteLineInput[]) {
  await db.delete(quoteLines).where(and(eq(quoteLines.quoteId, quoteId), eq(quoteLines.orgId, actor.orgId)));
  let subtotal = 0;
  const rows = lines.map((l, i) => {
    const unitPrice = l.unitPrice && l.unitPrice > 0 ? round4(l.unitPrice) : priceFromCost(l);
    const discountPct = Number(l.discountPct ?? 0);
    subtotal += lineAmount(Number(l.qty), unitPrice, discountPct);
    return {
      orgId: actor.orgId,
      quoteId,
      lineNo: i + 1,
      itemId: l.itemId ?? null,
      description: l.description,
      qty: Number(l.qty),
      materialCost: round4(Number(l.materialCost ?? 0)),
      laborCost: round4(Number(l.laborCost ?? 0)),
      outsideCost: round4(Number(l.outsideCost ?? 0)),
      overheadCost: round4(Number(l.overheadCost ?? 0)),
      marginPct: Number(l.marginPct ?? 0),
      unitPrice,
      leadTimeDays: Number(l.leadTimeDays ?? 14),
      discountPct,
      notes: l.notes ?? null,
    };
  });
  if (rows.length) await db.insert(quoteLines).values(rows);
  await db.update(quotes).set({ subtotal: round4(subtotal), updatedAt: new Date() }).where(eq(quotes.id, quoteId));
}

export async function setQuoteStatus(
  db: DbOrTx,
  actor: Actor,
  quoteId: string,
  status: (typeof QUOTE_STATUSES)[number],
  lostReason?: string,
) {
  await db
    .update(quotes)
    .set({ status, lostReason: lostReason ?? null, updatedAt: new Date() })
    .where(and(eq(quotes.id, quoteId), eq(quotes.orgId, actor.orgId)));
  await audit(db, { ...actor, action: `quote.${status}`, entityType: "quote", entityId: quoteId });
}

/** Mark sent quotes past their valid-until date as expired. */
export async function expireQuotes(db: DbOrTx, orgId: string, asOf: string) {
  const rows = await db
    .update(quotes)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(eq(quotes.orgId, orgId), eq(quotes.status, "sent"), sql`${quotes.validUntil} < ${asOf}`))
    .returning({ id: quotes.id });
  return rows.length;
}

/** Accepting a quote creates the sales order with the same lines and prices. */
export async function acceptQuote(db: DbOrTx, actor: Actor, quoteId: string, customerPo?: string | null) {
  const [quote] = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.orgId, actor.orgId)));
  if (!quote) throw new SalesError("Quote not found");
  if (quote.convertedOrderId) throw new SalesError("Quote already converted");
  const lines = await db.select().from(quoteLines).where(eq(quoteLines.quoteId, quoteId)).orderBy(asc(quoteLines.lineNo));
  const missing = lines.filter((l) => !l.itemId);
  if (missing.length) {
    throw new SalesError(
      `Line ${missing[0].lineNo} (${missing[0].description}) has no item. Create the item and set it on the quote line before converting.`,
    );
  }
  const maxLead = Math.max(0, ...lines.map((l) => l.leadTimeDays));
  const orderDate = new Date().toISOString().slice(0, 10);
  const promised = new Date(Date.now() + maxLead * 86_400_000).toISOString().slice(0, 10);
  const order = await createOrder(db, actor, {
    customerId: quote.customerId,
    customerPo: customerPo ?? null,
    orderDate,
    promisedDate: promised,
    quoteId: quote.id,
    notes: quote.notes,
    discountPct: Number(quote.discountPct),
    lines: lines.map((l) => ({
      itemId: l.itemId!,
      description: l.description,
      qty: Number(l.qty),
      unitPrice: Number(l.unitPrice),
      discountPct: Number(l.discountPct),
      promisedDate: promised,
      notes: l.notes,
    })),
  });
  await db
    .update(quotes)
    .set({ status: "accepted", convertedOrderId: order.id, updatedAt: new Date() })
    .where(eq(quotes.id, quoteId));
  await audit(db, { ...actor, action: "quote.accepted", entityType: "quote", entityId: quoteId, data: { orderId: order.id } });
  return order;
}

export type OrderLineInput = {
  itemId: string;
  description?: string | null;
  qty: number;
  unitPrice?: number | null;
  discountPct?: number | null;
  promisedDate?: string | null;
  notes?: string | null;
};

export type OrderHeaderInput = {
  customerId: string;
  customerPo?: string | null;
  program?: string | null;
  orderDate: string;
  promisedDate?: string | null;
  requestedDate?: string | null;
  notes?: string | null;
  internalNotes?: string | null;
  quoteId?: string | null;
  shipTo?: Address | null;
  shipVia?: string | null;
  freight?: number | null;
  discountPct?: number | null;
  termsDays?: number | null;
  salesRep?: string | null;
};

async function loadCustomer(db: DbOrTx, actor: Actor, customerId: string) {
  const [cust] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.orgId, actor.orgId)));
  if (!cust) throw new SalesError("Customer not found");
  return cust;
}

/** Fill blank prices from the price list and blank discounts from the customer's standard discount. */
async function resolveOrderLines(db: DbOrTx, actor: Actor, cust: typeof customers.$inferSelect, date: string, lines: OrderLineInput[], fallbackPromised: string | null) {
  const itemRows = await db
    .select({ id: items.id, name: items.name, sku: items.sku })
    .from(items)
    .where(and(eq(items.orgId, actor.orgId), inArray(items.id, lines.map((l) => l.itemId))));
  const out = [];
  for (const [i, l] of lines.entries()) {
    const it = itemRows.find((r) => r.id === l.itemId);
    if (!it) throw new SalesError("Item not found on line " + (i + 1));
    if (!(Number(l.qty) > 0)) throw new SalesError(`Line ${i + 1}: quantity must be positive`);
    const unitPrice = l.unitPrice != null && Number(l.unitPrice) > 0 ? Number(l.unitPrice) : ((await resolveSalesPrice(db, actor.orgId, cust.id, l.itemId, Number(l.qty), date)) ?? 0);
    const discountPct = l.discountPct != null ? Number(l.discountPct) : Number(cust.discountPct ?? 0);
    out.push({
      orgId: actor.orgId,
      lineNo: i + 1,
      itemId: l.itemId,
      description: l.description?.trim() || it.name,
      qty: Number(l.qty),
      unitPrice: round4(unitPrice),
      discountPct,
      promisedDate: l.promisedDate ?? fallbackPromised,
      notes: l.notes ?? null,
    });
  }
  return out;
}

export async function createOrder(db: DbOrTx, actor: Actor, input: OrderHeaderInput & { lines: OrderLineInput[] }) {
  if (!input.lines.length) throw new SalesError("An order needs at least one line");
  const cust = await loadCustomer(db, actor, input.customerId);
  const lines = await resolveOrderLines(db, actor, cust, input.orderDate, input.lines, input.promisedDate ?? null);
  const number = await nextNumber(db, actor.orgId, "order");
  const subtotal = round4(lines.reduce((s, l) => s + lineAmount(l.qty, l.unitPrice, l.discountPct), 0));
  const [order] = await db
    .insert(salesOrders)
    .values({
      orgId: actor.orgId,
      number,
      customerId: cust.id,
      customerPo: input.customerPo ?? null,
      program: input.program ?? null,
      orderDate: input.orderDate,
      promisedDate: input.promisedDate ?? null,
      requestedDate: input.requestedDate ?? null,
      notes: input.notes ?? null,
      internalNotes: input.internalNotes ?? null,
      quoteId: input.quoteId ?? null,
      shipTo: input.shipTo ?? cust.shippingAddress ?? null,
      shipVia: input.shipVia ?? cust.shipVia ?? null,
      freight: round4(Number(input.freight ?? 0)),
      discountPct: Number(input.discountPct ?? 0),
      termsDays: input.termsDays ?? cust.termsDays,
      salesRep: input.salesRep ?? cust.salesRep ?? null,
      holdReason: cust.creditHold ? "Customer on credit hold" : null,
      subtotal,
    })
    .returning();
  await db.insert(salesOrderLines).values(lines.map((l) => ({ ...l, orderId: order.id })));
  await audit(db, { ...actor, action: "order.create", entityType: "order", entityId: order.id });
  return order;
}

/** Edit a draft order: header and lines are replaced. */
export async function updateDraftOrder(db: DbOrTx, actor: Actor, orderId: string, input: OrderHeaderInput & { lines: OrderLineInput[] }) {
  const [o] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, orderId), eq(salesOrders.orgId, actor.orgId)));
  if (!o) throw new SalesError("Order not found");
  if (o.status !== "draft") throw new SalesError("Only draft orders can be edited this way; confirmed orders take line changes");
  if (!input.lines.length) throw new SalesError("An order needs at least one line");
  const cust = await loadCustomer(db, actor, input.customerId);
  const lines = await resolveOrderLines(db, actor, cust, input.orderDate, input.lines, input.promisedDate ?? null);
  const subtotal = round4(lines.reduce((s, l) => s + lineAmount(l.qty, l.unitPrice, l.discountPct), 0));
  await db.delete(salesOrderLines).where(eq(salesOrderLines.orderId, o.id));
  await db.insert(salesOrderLines).values(lines.map((l) => ({ ...l, orderId: o.id })));
  await db
    .update(salesOrders)
    .set({
      customerId: cust.id,
      customerPo: input.customerPo ?? null,
      program: input.program ?? null,
      orderDate: input.orderDate,
      promisedDate: input.promisedDate ?? null,
      requestedDate: input.requestedDate ?? null,
      notes: input.notes ?? null,
      internalNotes: input.internalNotes ?? null,
      shipTo: input.shipTo ?? o.shipTo,
      shipVia: input.shipVia ?? null,
      freight: round4(Number(input.freight ?? 0)),
      discountPct: Number(input.discountPct ?? 0),
      termsDays: input.termsDays ?? o.termsDays,
      salesRep: input.salesRep ?? null,
      subtotal,
      updatedAt: new Date(),
    })
    .where(eq(salesOrders.id, o.id));
  await audit(db, { ...actor, action: "order.update", entityType: "order", entityId: o.id });
}

/** Header changes on a confirmed order are allowed and logged. */
export async function updateOrderHeader(
  db: DbOrTx,
  actor: Actor,
  orderId: string,
  patch: { customerPo?: string | null; promisedDate?: string | null; requestedDate?: string | null; shipTo?: Address | null; shipVia?: string | null; freight?: number | null; notes?: string | null; internalNotes?: string | null; program?: string | null; salesRep?: string | null },
  reason: string,
) {
  const [o] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, orderId), eq(salesOrders.orgId, actor.orgId)));
  if (!o) throw new SalesError("Order not found");
  if (["cancelled", "closed"].includes(o.status)) throw new SalesError(`A ${o.status} order cannot be changed`);
  const set = {
    customerPo: patch.customerPo === undefined ? o.customerPo : patch.customerPo,
    promisedDate: patch.promisedDate === undefined ? o.promisedDate : patch.promisedDate,
    requestedDate: patch.requestedDate === undefined ? o.requestedDate : patch.requestedDate,
    shipTo: patch.shipTo === undefined ? o.shipTo : patch.shipTo,
    shipVia: patch.shipVia === undefined ? o.shipVia : patch.shipVia,
    freight: patch.freight === undefined || patch.freight === null ? o.freight : round4(Number(patch.freight)),
    notes: patch.notes === undefined ? o.notes : patch.notes,
    internalNotes: patch.internalNotes === undefined ? o.internalNotes : patch.internalNotes,
    program: patch.program === undefined ? o.program : patch.program,
    salesRep: patch.salesRep === undefined ? o.salesRep : patch.salesRep,
    updatedAt: new Date(),
  };
  await db.update(salesOrders).set(set).where(eq(salesOrders.id, o.id));
  if (o.status !== "draft") {
    const changed = Object.entries(patch).filter(([k, v]) => v !== undefined && JSON.stringify(v) !== JSON.stringify((o as Record<string, unknown>)[k]));
    await db.insert(orderChanges).values({
      orgId: actor.orgId,
      orderId: o.id,
      userId: actor.userId,
      description: `Header: ${reason}`,
      data: { changed: Object.fromEntries(changed.map(([k, v]) => [k, { before: (o as Record<string, unknown>)[k], after: v }])) },
    });
  }
}

/** Add a line to a confirmed order; logged as a change. */
export async function addOrderLine(db: DbOrTx, actor: Actor, orderId: string, line: OrderLineInput, reason: string) {
  const [o] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, orderId), eq(salesOrders.orgId, actor.orgId)));
  if (!o) throw new SalesError("Order not found");
  if (["cancelled", "closed", "invoiced"].includes(o.status)) throw new SalesError(`Lines cannot be added to a ${o.status} order`);
  const cust = await loadCustomer(db, actor, o.customerId);
  const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${salesOrderLines.lineNo}), 0)::int` }).from(salesOrderLines).where(eq(salesOrderLines.orderId, o.id));
  const [resolved] = await resolveOrderLines(db, actor, cust, o.orderDate, [line], o.promisedDate);
  const [row] = await db
    .insert(salesOrderLines)
    .values({ ...resolved, lineNo: Number(n) + 1, orderId: o.id })
    .returning();
  await recomputeOrderTotals(db, actor.orgId, o.id);
  if (o.status !== "draft") {
    await db.insert(orderChanges).values({ orgId: actor.orgId, orderId: o.id, userId: actor.userId, description: `Line ${row.lineNo} added: ${reason}`, data: { line: { itemId: row.itemId, qty: row.qty, unitPrice: row.unitPrice } } });
  }
  await recomputeOrderStatus(db, actor.orgId, o.id);
  return row;
}

/** Cancel the unshipped balance of a line; logged. */
export async function cancelOrderLine(db: DbOrTx, actor: Actor, lineId: string, reason: string) {
  const [line] = await db.select().from(salesOrderLines).where(and(eq(salesOrderLines.id, lineId), eq(salesOrderLines.orgId, actor.orgId)));
  if (!line) throw new SalesError("Line not found");
  const open = round4(Number(line.qty) - Number(line.qtyShipped) - Number(line.qtyCancelled));
  if (open <= 0) throw new SalesError("Nothing open on this line");
  await db.update(salesOrderLines).set({ qtyCancelled: round4(Number(line.qtyCancelled) + open), updatedAt: new Date() }).where(eq(salesOrderLines.id, line.id));
  await recomputeOrderTotals(db, actor.orgId, line.orderId);
  await db.insert(orderChanges).values({ orgId: actor.orgId, orderId: line.orderId, userId: actor.userId, description: `Line ${line.lineNo}: ${open} cancelled. ${reason}` });
  await recomputeOrderStatus(db, actor.orgId, line.orderId);
}

/** Open receivables for a customer, for credit checks. */
export async function openReceivables(db: DbOrTx, orgId: string, customerId: string) {
  const [row] = await db
    .select({ open: sql<number>`coalesce(sum(${invoices.total} - ${invoices.amountPaid}), 0)`.mapWith(Number) })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.customerId, customerId), eq(invoices.status, "issued")));
  return row?.open ?? 0;
}

export async function confirmOrder(db: DbOrTx, actor: Actor, orderId: string, opts: { overrideCredit?: boolean } = {}) {
  const [o] = await db
    .select()
    .from(salesOrders)
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.orgId, actor.orgId)));
  if (!o) throw new SalesError("Order not found");
  if (o.status !== "draft") throw new SalesError("Only draft orders can be confirmed");
  const cust = await loadCustomer(db, actor, o.customerId);
  if (!opts.overrideCredit) {
    if (cust.creditHold) {
      await db.update(salesOrders).set({ holdReason: "Customer on credit hold", updatedAt: new Date() }).where(eq(salesOrders.id, o.id));
      throw new SalesError(`${cust.name} is on credit hold. An owner can override below.`);
    }
    if (Number(cust.creditLimit) > 0) {
      const open = await openReceivables(db, actor.orgId, cust.id);
      if (open + Number(o.subtotal) > Number(cust.creditLimit)) {
        const reason = `Credit limit: ${(open + Number(o.subtotal)).toFixed(2)} open against ${Number(cust.creditLimit).toFixed(2)}`;
        await db.update(salesOrders).set({ holdReason: reason, updatedAt: new Date() }).where(eq(salesOrders.id, o.id));
        throw new SalesError(`${reason}. An owner can override below.`);
      }
    }
  }
  await db.update(salesOrders).set({ status: "confirmed", holdReason: null, updatedAt: new Date() }).where(eq(salesOrders.id, orderId));
  await audit(db, { ...actor, action: "order.confirm", entityType: "order", entityId: orderId, data: opts.overrideCredit ? { creditOverride: true } : undefined });
}

export async function cancelOrder(db: DbOrTx, actor: Actor, orderId: string, reason: string) {
  const [o] = await db
    .select()
    .from(salesOrders)
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.orgId, actor.orgId)));
  if (!o) throw new SalesError("Order not found");
  if (["shipped", "invoiced", "closed"].includes(o.status)) throw new SalesError("Shipped orders cannot be cancelled");
  await db.update(salesOrders).set({ status: "cancelled", updatedAt: new Date() }).where(eq(salesOrders.id, orderId));
  await db.insert(orderChanges).values({ orgId: actor.orgId, orderId, userId: actor.userId, description: `Cancelled: ${reason}` });
  await audit(db, { ...actor, action: "order.cancel", entityType: "order", entityId: orderId, data: { reason } });
}

/** Change after confirmation: logged, never silent. */
export async function changeOrderLine(
  db: DbOrTx,
  actor: Actor,
  lineId: string,
  patch: { qty?: number; unitPrice?: number; promisedDate?: string | null; discountPct?: number },
  reason: string,
) {
  const [line] = await db
    .select()
    .from(salesOrderLines)
    .where(and(eq(salesOrderLines.id, lineId), eq(salesOrderLines.orgId, actor.orgId)));
  if (!line) throw new SalesError("Line not found");
  if (patch.qty !== undefined && patch.qty < Number(line.qtyShipped)) {
    throw new SalesError(`Cannot reduce below ${line.qtyShipped} already shipped`);
  }
  await db
    .update(salesOrderLines)
    .set({
      qty: patch.qty ?? line.qty,
      unitPrice: patch.unitPrice ?? line.unitPrice,
      discountPct: patch.discountPct ?? line.discountPct,
      promisedDate: patch.promisedDate === undefined ? line.promisedDate : patch.promisedDate,
      updatedAt: new Date(),
    })
    .where(eq(salesOrderLines.id, lineId));
  await recomputeOrderTotals(db, actor.orgId, line.orderId);
  await db.insert(orderChanges).values({
    orgId: actor.orgId,
    orderId: line.orderId,
    userId: actor.userId,
    description: `Line ${line.lineNo}: ${reason}`,
    data: { before: { qty: line.qty, unitPrice: line.unitPrice, discountPct: line.discountPct, promisedDate: line.promisedDate }, after: patch },
  });
}

export async function recomputeOrderTotals(db: DbOrTx, orgId: string, orderId: string) {
  const lines = await db.select().from(salesOrderLines).where(and(eq(salesOrderLines.orderId, orderId), eq(salesOrderLines.orgId, orgId)));
  const subtotal = lines.reduce((s, l) => s + lineAmount(Number(l.qty) - Number(l.qtyCancelled), Number(l.unitPrice), Number(l.discountPct)), 0);
  await db.update(salesOrders).set({ subtotal: round4(subtotal) }).where(eq(salesOrders.id, orderId));
}

/** Derive the order status from its lines (called after ship / invoice / WO events). */
export async function recomputeOrderStatus(db: DbOrTx, orgId: string, orderId: string) {
  const [o] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, orderId), eq(salesOrders.orgId, orgId)));
  if (!o || ["draft", "cancelled", "closed"].includes(o.status)) return;
  const lines = await db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, orderId));
  const totalQty = lines.reduce((s, l) => s + Number(l.qty) - Number(l.qtyCancelled), 0);
  const shipped = lines.reduce((s, l) => s + Number(l.qtyShipped), 0);
  const invoiced = lines.reduce((s, l) => s + Number(l.qtyInvoiced), 0);
  let status = o.status;
  if (invoiced >= totalQty - 1e-9 && totalQty > 0) status = "invoiced";
  else if (shipped >= totalQty - 1e-9 && totalQty > 0) status = "shipped";
  else if (shipped > 0) status = "partially_shipped";
  else if (o.status === "in_production") status = "in_production";
  else status = "confirmed";
  if (status !== o.status) await db.update(salesOrders).set({ status, updatedAt: new Date() }).where(eq(salesOrders.id, orderId));
}

export async function listOrders(db: DbOrTx, orgId: string, filter: { status?: string; customerId?: string; q?: string; program?: string } | string = {}) {
  const f = typeof filter === "string" ? { status: filter } : filter;
  const conds = [eq(salesOrders.orgId, orgId)];
  if (f.status === "open") conds.push(inArray(salesOrders.status, ["confirmed", "in_production", "partially_shipped"]));
  else if (f.status) conds.push(eq(salesOrders.status, f.status as (typeof salesOrders.status.enumValues)[number]));
  if (f.customerId) conds.push(eq(salesOrders.customerId, f.customerId));
  if (f.program) conds.push(eq(salesOrders.program, f.program));
  if (f.q) conds.push(or(ilike(salesOrders.number, `%${f.q}%`), ilike(customers.name, `%${f.q}%`), ilike(salesOrders.customerPo, `%${f.q}%`), ilike(salesOrders.program, `%${f.q}%`))!);
  return db
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      status: salesOrders.status,
      orderDate: salesOrders.orderDate,
      promisedDate: salesOrders.promisedDate,
      requestedDate: salesOrders.requestedDate,
      customerPo: salesOrders.customerPo,
      program: salesOrders.program,
      subtotal: salesOrders.subtotal,
      holdReason: salesOrders.holdReason,
      customerName: customers.name,
      customerId: customers.id,
    })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(...conds))
    .orderBy(desc(salesOrders.orderDate), desc(salesOrders.number));
}

export async function listQuotes(db: DbOrTx, orgId: string, filter: { status?: string; customerId?: string; q?: string } = {}) {
  const conds = [eq(quotes.orgId, orgId)];
  if (filter.status) conds.push(eq(quotes.status, filter.status as (typeof quotes.status.enumValues)[number]));
  if (filter.customerId) conds.push(eq(quotes.customerId, filter.customerId));
  if (filter.q) conds.push(or(ilike(quotes.number, `%${filter.q}%`), ilike(customers.name, `%${filter.q}%`), ilike(quotes.customerRfq, `%${filter.q}%`))!);
  return db
    .select({ q: quotes, customerName: customers.name })
    .from(quotes)
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .where(and(...conds))
    .orderBy(desc(quotes.quoteDate), desc(quotes.number));
}
