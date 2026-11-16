import { and, desc, eq, gte, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import {
  customers,
  invoices,
  items,
  laborEntries,
  salesOrderLines,
  salesOrders,
  shipmentLines,
  shipments,
  vendorBills,
  workOrders,
} from "@/lib/db/schema";
import { addDays, round4, today } from "@/lib/money";
import { balanceOfSubtype } from "@/modules/books/service";
import { inventoryLedgerValue } from "@/modules/inventory/service";
import { shortageReport } from "@/modules/purchasing/service";

const OPEN_ORDER = ["confirmed", "in_production", "partially_shipped"] as const;

export async function todaySummary(db: DbOrTx, orgId: string) {
  const t = today();
  const weekOut = addDays(t, 7);
  const openOrders = await db
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      status: salesOrders.status,
      promisedDate: salesOrders.promisedDate,
      subtotal: salesOrders.subtotal,
      customerName: customers.name,
    })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(salesOrders.orgId, orgId), inArray(salesOrders.status, [...OPEN_ORDER])))
    .orderBy(salesOrders.promisedDate);
  const late = openOrders.filter((o) => o.promisedDate && o.promisedDate < t);
  const dueThisWeek = openOrders.filter((o) => o.promisedDate && o.promisedDate >= t && o.promisedDate <= weekOut);
  const backlog = round4(openOrders.reduce((s, o) => s + Number(o.subtotal), 0));

  const openWos = await db
    .select({ id: workOrders.id, number: workOrders.number, status: workOrders.status, dueDate: workOrders.dueDate, qty: workOrders.qty, sku: items.sku })
    .from(workOrders)
    .innerJoin(items, eq(items.id, workOrders.itemId))
    .where(and(eq(workOrders.orgId, orgId), inArray(workOrders.status, ["planned", "released", "in_progress"])))
    .orderBy(workOrders.dueDate);
  const lateWos = openWos.filter((w) => w.dueDate && w.dueDate < t);

  const shortages = await shortageReport(db, orgId);
  const [clockedIn] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(laborEntries)
    .where(and(eq(laborEntries.orgId, orgId), sql`${laborEntries.endedAt} is null`));

  const [arOpen] = await db
    .select({ v: sql<number>`coalesce(sum(${invoices.total} - ${invoices.amountPaid}), 0)`.mapWith(Number) })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.status, "issued")));
  const [arOverdue] = await db
    .select({ v: sql<number>`coalesce(sum(${invoices.total} - ${invoices.amountPaid}), 0)`.mapWith(Number) })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.status, "issued"), lt(invoices.dueDate, t)));
  const [apOpen] = await db
    .select({ v: sql<number>`coalesce(sum(${vendorBills.total} - ${vendorBills.amountPaid}), 0)`.mapWith(Number) })
    .from(vendorBills)
    .where(and(eq(vendorBills.orgId, orgId), inArray(vendorBills.status, ["approved", "draft"])));
  const [apDueWeek] = await db
    .select({ v: sql<number>`coalesce(sum(${vendorBills.total} - ${vendorBills.amountPaid}), 0)`.mapWith(Number) })
    .from(vendorBills)
    .where(and(eq(vendorBills.orgId, orgId), inArray(vendorBills.status, ["approved", "draft"]), lte(vendorBills.dueDate, weekOut)));

  const cash = await balanceOfSubtype(db, orgId, "cash");
  const wip = await balanceOfSubtype(db, orgId, "wip");
  const inventoryValue = await inventoryLedgerValue(db, orgId);
  const otd = await onTimeDelivery(db, orgId, 30);

  return {
    date: t,
    openOrders,
    late,
    dueThisWeek,
    backlog,
    openWos,
    lateWos,
    shortages,
    clockedIn: clockedIn?.n ?? 0,
    arOpen: round4(arOpen?.v ?? 0),
    arOverdue: round4(arOverdue?.v ?? 0),
    apOpen: round4(apOpen?.v ?? 0),
    apDueWeek: round4(apDueWeek?.v ?? 0),
    cash,
    wip,
    inventoryValue,
    otd,
  };
}

/** Share of shipments in the window whose lines left on or before the promised date. */
export async function onTimeDelivery(db: DbOrTx, orgId: string, days: number) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({ shippedAt: shipments.shippedAt, promised: salesOrderLines.promisedDate, orderPromised: salesOrders.promisedDate })
    .from(shipmentLines)
    .innerJoin(shipments, eq(shipments.id, shipmentLines.shipmentId))
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, shipmentLines.orderLineId))
    .innerJoin(salesOrders, eq(salesOrders.id, shipments.orderId))
    .where(and(eq(shipments.orgId, orgId), eq(shipments.status, "shipped"), isNotNull(shipments.shippedAt), gte(shipments.shippedAt, since)));
  if (!rows.length) return { pct: null as number | null, onTime: 0, total: 0 };
  let onTime = 0;
  for (const r of rows) {
    const promised = r.promised ?? r.orderPromised;
    if (!promised || !r.shippedAt) {
      onTime++;
      continue;
    }
    if (r.shippedAt.toISOString().slice(0, 10) <= promised) onTime++;
  }
  return { pct: round4((onTime / rows.length) * 100), onTime, total: rows.length };
}

/** Job margin: revenue on the order line vs actual work-order cost. */
export async function jobMargins(db: DbOrTx, orgId: string, limit = 50) {
  const rows = await db
    .select({
      woId: workOrders.id,
      woNumber: workOrders.number,
      status: workOrders.status,
      completedAt: workOrders.completedAt,
      sku: items.sku,
      qty: workOrders.qty,
      qtyComplete: workOrders.qtyComplete,
      materialCost: workOrders.materialCost,
      laborCost: workOrders.laborCost,
      outsideCost: workOrders.outsideCost,
      overheadCost: workOrders.overheadCost,
      unitPrice: salesOrderLines.unitPrice,
      lineQty: salesOrderLines.qty,
      orderNumber: salesOrders.number,
      customerName: customers.name,
    })
    .from(workOrders)
    .innerJoin(items, eq(items.id, workOrders.itemId))
    .leftJoin(salesOrderLines, eq(salesOrderLines.id, workOrders.salesOrderLineId))
    .leftJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
    .leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(workOrders.orgId, orgId), inArray(workOrders.status, ["complete", "closed"])))
    .orderBy(desc(workOrders.completedAt))
    .limit(limit);
  return rows.map((r) => {
    const cost = round4(Number(r.materialCost) + Number(r.laborCost) + Number(r.outsideCost) + Number(r.overheadCost));
    const revenue = r.unitPrice ? round4(Number(r.unitPrice) * Number(r.qtyComplete)) : null;
    const margin = revenue !== null ? round4(revenue - cost) : null;
    const marginPct = revenue ? round4((margin! / revenue) * 100) : null;
    return { ...r, cost, revenue, margin, marginPct };
  });
}

/** Revenue and gross margin by customer from completed work orders. */
export async function customerMargins(db: DbOrTx, orgId: string) {
  const jobs = await jobMargins(db, orgId, 1000);
  const map = new Map<string, { customer: string; revenue: number; cost: number; jobs: number }>();
  for (const j of jobs) {
    if (j.revenue === null) continue;
    const key = j.customerName ?? "—";
    const m = map.get(key) ?? { customer: key, revenue: 0, cost: 0, jobs: 0 };
    m.revenue = round4(m.revenue + j.revenue);
    m.cost = round4(m.cost + j.cost);
    m.jobs++;
    map.set(key, m);
  }
  return [...map.values()]
    .map((m) => ({ ...m, margin: round4(m.revenue - m.cost), marginPct: m.revenue ? round4(((m.revenue - m.cost) / m.revenue) * 100) : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}
