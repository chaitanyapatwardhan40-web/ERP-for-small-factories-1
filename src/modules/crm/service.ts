import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { customers, items, salesOrderLines, salesOrders } from "@/lib/db/schema";
import { round4 } from "@/lib/money";

/**
 * Reactivation radar: customers who used to order and have gone quiet,
 * with what they used to buy. The ERP already knows this; a CRM would
 * have to be told.
 */
export async function reactivationRadar(db: DbOrTx, orgId: string, quietDays = 180) {
  const since = new Date(Date.now() - quietDays * 86_400_000).toISOString().slice(0, 10);
  const last = await db
    .select({
      customerId: salesOrders.customerId,
      lastOrder: sql<string>`max(${salesOrders.orderDate})`,
      orders: sql<number>`count(*)`.mapWith(Number),
      revenue: sql<number>`coalesce(sum(${salesOrders.subtotal}), 0)`.mapWith(Number),
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.orgId, orgId), sql`${salesOrders.status} <> 'cancelled'`))
    .groupBy(salesOrders.customerId);
  const quiet = last.filter((l) => l.lastOrder < since);
  if (!quiet.length) return [];
  const custs = await db.select().from(customers).where(and(eq(customers.orgId, orgId), inArray(customers.id, quiet.map((q) => q.customerId)), eq(customers.active, true)));
  const topItems = await db
    .select({ customerId: salesOrders.customerId, sku: items.sku, qty: sql<number>`sum(${salesOrderLines.qty})`.mapWith(Number) })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
    .innerJoin(items, eq(items.id, salesOrderLines.itemId))
    .where(and(eq(salesOrderLines.orgId, orgId), inArray(salesOrders.customerId, quiet.map((q) => q.customerId))))
    .groupBy(salesOrders.customerId, items.sku)
    .orderBy(desc(sql`sum(${salesOrderLines.qty})`));
  return custs
    .map((c) => {
      const l = quiet.find((q) => q.customerId === c.id)!;
      const days = Math.floor((Date.now() - new Date(`${l.lastOrder}T00:00:00`).getTime()) / 86_400_000);
      return {
        customer: c,
        lastOrder: l.lastOrder,
        daysQuiet: days,
        orders: l.orders,
        revenue: round4(l.revenue),
        usedToBuy: topItems.filter((t) => t.customerId === c.id).slice(0, 3).map((t) => t.sku),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

export function draftReactivationEmail(shopName: string, customerName: string, skus: string[], daysQuiet: number) {
  const parts = skus.length ? `the ${skus.slice(0, 2).join(" and ")} you used to order` : "the parts we built for you";
  return {
    subject: `${shopName}: still making ${skus[0] ?? "your parts"}`,
    body: `Hi ${customerName.split(" ")[0]},\n\nIt has been about ${Math.round(daysQuiet / 30)} months since we last built ${parts}. We still have the tooling, drawings and pricing on file, so a repeat run would go straight to the floor.\n\nIf you have a forecast or an RFQ coming up, reply to this email and we will quote it the same day.\n\nThanks,\n${shopName}`,
  };
}
