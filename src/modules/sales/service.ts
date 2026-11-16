import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import {
  customers,
  items,
  orderChanges,
  quoteLines,
  quotes,
  salesOrderLines,
  salesOrders,
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

export async function createQuote(
  db: DbOrTx,
  actor: Actor,
  input: {
    customerId: string;
    quoteDate: string;
    validUntil?: string | null;
    customerRfq?: string | null;
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
      notes: input.notes ?? null,
    })
    .returning();
  await replaceQuoteLines(db, actor, quote.id, input.lines);
  await audit(db, { ...actor, action: "quote.create", entityType: "quote", entityId: quote.id });
  return quote;
}

export async function replaceQuoteLines(db: DbOrTx, actor: Actor, quoteId: string, lines: QuoteLineInput[]) {
  await db.delete(quoteLines).where(and(eq(quoteLines.quoteId, quoteId), eq(quoteLines.orgId, actor.orgId)));
  let subtotal = 0;
  const rows = lines.map((l, i) => {
    const unitPrice = l.unitPrice && l.unitPrice > 0 ? round4(l.unitPrice) : priceFromCost(l);
    subtotal += unitPrice * Number(l.qty);
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
    lines: lines.map((l) => ({
      itemId: l.itemId!,
      description: l.description,
      qty: Number(l.qty),
      unitPrice: Number(l.unitPrice),
      promisedDate: promised,
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
  description?: string;
  qty: number;
  unitPrice: number;
  promisedDate?: string | null;
};

export async function createOrder(
  db: DbOrTx,
  actor: Actor,
  input: {
    customerId: string;
    customerPo?: string | null;
    program?: string | null;
    orderDate: string;
    promisedDate?: string | null;
    notes?: string | null;
    quoteId?: string | null;
    lines: OrderLineInput[];
  },
) {
  if (!input.lines.length) throw new SalesError("An order needs at least one line");
  const [cust] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.orgId, actor.orgId)));
  if (!cust) throw new SalesError("Customer not found");
  const itemRows = await db
    .select({ id: items.id, name: items.name, sku: items.sku })
    .from(items)
    .where(and(eq(items.orgId, actor.orgId), inArray(items.id, input.lines.map((l) => l.itemId))));
  const number = await nextNumber(db, actor.orgId, "order");
  const subtotal = round4(input.lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0));
  const [order] = await db
    .insert(salesOrders)
    .values({
      orgId: actor.orgId,
      number,
      customerId: input.customerId,
      customerPo: input.customerPo ?? null,
      program: input.program ?? null,
      orderDate: input.orderDate,
      promisedDate: input.promisedDate ?? null,
      notes: input.notes ?? null,
      quoteId: input.quoteId ?? null,
      subtotal,
    })
    .returning();
  await db.insert(salesOrderLines).values(
    input.lines.map((l, i) => {
      const it = itemRows.find((r) => r.id === l.itemId);
      if (!it) throw new SalesError("Item not found on line " + (i + 1));
      return {
        orgId: actor.orgId,
        orderId: order.id,
        lineNo: i + 1,
        itemId: l.itemId,
        description: l.description || it.name,
        qty: Number(l.qty),
        unitPrice: round4(Number(l.unitPrice)),
        promisedDate: l.promisedDate ?? input.promisedDate ?? null,
      };
    }),
  );
  await audit(db, { ...actor, action: "order.create", entityType: "order", entityId: order.id });
  return order;
}

export async function confirmOrder(db: DbOrTx, actor: Actor, orderId: string) {
  const [o] = await db
    .select()
    .from(salesOrders)
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.orgId, actor.orgId)));
  if (!o) throw new SalesError("Order not found");
  if (o.status !== "draft") throw new SalesError("Only draft orders can be confirmed");
  await db.update(salesOrders).set({ status: "confirmed", updatedAt: new Date() }).where(eq(salesOrders.id, orderId));
  await audit(db, { ...actor, action: "order.confirm", entityType: "order", entityId: orderId });
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
}

/** Change after confirmation: logged, never silent. */
export async function changeOrderLine(
  db: DbOrTx,
  actor: Actor,
  lineId: string,
  patch: { qty?: number; unitPrice?: number; promisedDate?: string | null },
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
    data: { before: { qty: line.qty, unitPrice: line.unitPrice, promisedDate: line.promisedDate }, after: patch },
  });
}

export async function recomputeOrderTotals(db: DbOrTx, orgId: string, orderId: string) {
  const [row] = await db
    .select({ subtotal: sql<number>`coalesce(sum(${salesOrderLines.qty} * ${salesOrderLines.unitPrice}), 0)`.mapWith(Number) })
    .from(salesOrderLines)
    .where(and(eq(salesOrderLines.orderId, orderId), eq(salesOrderLines.orgId, orgId)));
  await db.update(salesOrders).set({ subtotal: round4(row?.subtotal ?? 0) }).where(eq(salesOrders.id, orderId));
}

/** Derive the order status from its lines (called after ship / invoice / WO events). */
export async function recomputeOrderStatus(db: DbOrTx, orgId: string, orderId: string) {
  const [o] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, orderId), eq(salesOrders.orgId, orgId)));
  if (!o || ["draft", "cancelled", "closed"].includes(o.status)) return;
  const lines = await db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, orderId));
  const totalQty = lines.reduce((s, l) => s + Number(l.qty), 0);
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

export async function listOrders(db: DbOrTx, orgId: string, status?: string) {
  const conds = [eq(salesOrders.orgId, orgId)];
  if (status) conds.push(eq(salesOrders.status, status as (typeof salesOrders.status.enumValues)[number]));
  return db
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      status: salesOrders.status,
      orderDate: salesOrders.orderDate,
      promisedDate: salesOrders.promisedDate,
      customerPo: salesOrders.customerPo,
      program: salesOrders.program,
      subtotal: salesOrders.subtotal,
      customerName: customers.name,
      customerId: customers.id,
    })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(...conds))
    .orderBy(desc(salesOrders.orderDate), desc(salesOrders.number));
}
