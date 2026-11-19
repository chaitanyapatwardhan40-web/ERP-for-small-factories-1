import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import {
  employees,
  items,
  laborEntries,
  locations,
  routingOperations,
  salesOrderLines,
  salesOrders,
  workCenters,
  workOrderMaterials,
  workOrderOperations,
  workOrders,
} from "@/lib/db/schema";
import { nextNumber } from "@/lib/numbering";
import { audit } from "@/lib/audit";
import { round4 } from "@/lib/money";
import { activeBom, activeRouting, explodeForWorkOrder } from "@/modules/items/service";
import { moveStock, onHand } from "@/modules/inventory/service";
import { postEvent } from "@/modules/books/service";
import { recomputeOrderStatus } from "@/modules/sales/service";

export class ProductionError extends Error {}
type Actor = { orgId: string; userId: string };

const today = () => new Date().toISOString().slice(0, 10);

/** Plan a work order: copy the active BOM (exploded) and routing onto it. */
export async function createWorkOrder(
  db: DbOrTx,
  actor: Actor,
  input: { itemId: string; qty: number; dueDate?: string | null; salesOrderLineId?: string | null; priority?: number; notes?: string | null },
) {
  const [item] = await db.select().from(items).where(and(eq(items.id, input.itemId), eq(items.orgId, actor.orgId)));
  if (!item) throw new ProductionError("Item not found");
  if (item.type !== "make") throw new ProductionError(`${item.sku} is a ${item.type} item; only make items get work orders`);
  const qty = Number(input.qty);
  if (qty <= 0) throw new ProductionError("Quantity must be positive");
  const bom = await activeBom(db, actor.orgId, item.id);
  const routing = await activeRouting(db, actor.orgId, item.id);
  const number = await nextNumber(db, actor.orgId, "wo");
  const [wo] = await db
    .insert(workOrders)
    .values({
      orgId: actor.orgId,
      number,
      itemId: item.id,
      qty,
      dueDate: input.dueDate ?? null,
      salesOrderLineId: input.salesOrderLineId ?? null,
      bomRevisionId: bom?.id ?? null,
      routingId: routing?.id ?? null,
      priority: input.priority ?? 5,
      notes: input.notes ?? null,
    })
    .returning();
  const exploded = await explodeForWorkOrder(db, actor.orgId, item.id, qty);
  if (exploded.length) {
    await db.insert(workOrderMaterials).values(
      exploded.map((l) => ({ orgId: actor.orgId, workOrderId: wo.id, itemId: l.itemId, qtyRequired: l.qty })),
    );
  }
  if (routing) {
    const ops = await db.select().from(routingOperations).where(eq(routingOperations.routingId, routing.id)).orderBy(asc(routingOperations.seq));
    if (ops.length) {
      await db.insert(workOrderOperations).values(
        ops.map((op) => ({
          orgId: actor.orgId,
          workOrderId: wo.id,
          seq: op.seq,
          name: op.name,
          workCenterId: op.workCenterId,
          plannedSetupHours: Number(op.setupHours),
          plannedRunHours: round4(Number(op.runHoursPerUnit) * qty),
          outsideVendorId: op.outsideVendorId,
          outsideCostPerUnit: Number(op.outsideCostPerUnit),
          instructions: op.instructions,
        })),
      );
    }
  }
  await audit(db, { ...actor, action: "wo.create", entityType: "wo", entityId: wo.id });
  return wo;
}

/** One work order per open make-item line on a confirmed order. */
export async function createWorkOrdersForOrder(db: DbOrTx, actor: Actor, orderId: string) {
  const [order] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, orderId), eq(salesOrders.orgId, actor.orgId)));
  if (!order) throw new ProductionError("Order not found");
  const lines = await db
    .select({ line: salesOrderLines, itemType: items.type })
    .from(salesOrderLines)
    .innerJoin(items, eq(items.id, salesOrderLines.itemId))
    .where(eq(salesOrderLines.orderId, orderId));
  const existing = await db
    .select({ lineId: workOrders.salesOrderLineId })
    .from(workOrders)
    .where(and(eq(workOrders.orgId, actor.orgId), inArray(workOrders.salesOrderLineId, lines.map((l) => l.line.id))));
  const created = [];
  for (const { line, itemType } of lines) {
    if (itemType !== "make") continue;
    if (existing.some((e) => e.lineId === line.id)) continue;
    created.push(
      await createWorkOrder(db, actor, {
        itemId: line.itemId,
        qty: Number(line.qty) - Number(line.qtyShipped),
        dueDate: line.promisedDate ?? order.promisedDate,
        salesOrderLineId: line.id,
      }),
    );
  }
  if (created.length && order.status === "confirmed") {
    await db.update(salesOrders).set({ status: "in_production", updatedAt: new Date() }).where(eq(salesOrders.id, orderId));
  }
  return created;
}

export async function releaseWorkOrder(db: DbOrTx, actor: Actor, workOrderId: string) {
  const wo = await getWo(db, actor.orgId, workOrderId);
  if (wo.status !== "planned") throw new ProductionError("Only planned work orders can be released");
  await db.update(workOrders).set({ status: "released", startDate: wo.startDate ?? today(), updatedAt: new Date() }).where(eq(workOrders.id, wo.id));
  await audit(db, { ...actor, action: "wo.release", entityType: "wo", entityId: wo.id });
}

async function getWo(db: DbOrTx, orgId: string, id: string) {
  const [wo] = await db.select().from(workOrders).where(and(eq(workOrders.id, id), eq(workOrders.orgId, orgId)));
  if (!wo) throw new ProductionError("Work order not found");
  return wo;
}

async function markInProgress(db: DbOrTx, wo: typeof workOrders.$inferSelect) {
  if (wo.status === "released") {
    await db.update(workOrders).set({ status: "in_progress", updatedAt: new Date() }).where(eq(workOrders.id, wo.id));
  }
}

/** Issue material from stock into WIP. Posts WIP / Inventory at average cost. */
export async function issueMaterial(
  db: DbOrTx,
  actor: Actor,
  input: { workOrderId: string; itemId: string; qty: number; locationId: string; lotNumber?: string | null },
) {
  const wo = await getWo(db, actor.orgId, input.workOrderId);
  if (!["released", "in_progress"].includes(wo.status)) throw new ProductionError("Release the work order before issuing material");
  const qty = Number(input.qty);
  if (qty <= 0) throw new ProductionError("Quantity must be positive");
  const { value } = await moveStock(db, {
    orgId: actor.orgId,
    userId: actor.userId,
    itemId: input.itemId,
    locationId: input.locationId,
    qty: -qty,
    type: "issue",
    lotNumber: input.lotNumber ?? null,
    refType: "wo",
    refId: wo.id,
    memo: `Issued to ${wo.number}`,
    glEvent: "production.issue",
  });
  const [mat] = await db
    .select()
    .from(workOrderMaterials)
    .where(and(eq(workOrderMaterials.workOrderId, wo.id), eq(workOrderMaterials.itemId, input.itemId)));
  if (mat) {
    await db.update(workOrderMaterials).set({ qtyIssued: round4(Number(mat.qtyIssued) + qty), updatedAt: new Date() }).where(eq(workOrderMaterials.id, mat.id));
  } else {
    await db.insert(workOrderMaterials).values({ orgId: actor.orgId, workOrderId: wo.id, itemId: input.itemId, qtyRequired: 0, qtyIssued: qty });
  }
  await db.update(workOrders).set({ materialCost: sql`${workOrders.materialCost} + ${value}`, updatedAt: new Date() }).where(eq(workOrders.id, wo.id));
  await markInProgress(db, wo);
  return value;
}

/** Issue every remaining requirement from one location; returns what could not be issued. */
export async function issueAllMaterials(db: DbOrTx, actor: Actor, workOrderId: string, locationId: string) {
  const mats = await db
    .select({ m: workOrderMaterials, sku: items.sku })
    .from(workOrderMaterials)
    .innerJoin(items, eq(items.id, workOrderMaterials.itemId))
    .where(eq(workOrderMaterials.workOrderId, workOrderId));
  const short: { sku: string; needed: number; available: number }[] = [];
  for (const { m, sku } of mats) {
    const remaining = round4(Number(m.qtyRequired) - Number(m.qtyIssued));
    if (remaining <= 0) continue;
    const available = await onHand(db, actor.orgId, m.itemId, locationId);
    if (available + 1e-9 < remaining) {
      short.push({ sku, needed: remaining, available });
      continue;
    }
    await issueMaterial(db, actor, { workOrderId, itemId: m.itemId, qty: remaining, locationId });
  }
  return short;
}

export async function clockIn(db: DbOrTx, actor: Actor, input: { operationId: string; employeeId: string }) {
  const [op] = await db.select().from(workOrderOperations).where(and(eq(workOrderOperations.id, input.operationId), eq(workOrderOperations.orgId, actor.orgId)));
  if (!op) throw new ProductionError("Operation not found");
  const wo = await getWo(db, actor.orgId, op.workOrderId);
  if (!["released", "in_progress"].includes(wo.status)) throw new ProductionError(`${wo.number} is ${wo.status}`);
  const [emp] = await db.select().from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.orgId, actor.orgId)));
  if (!emp) throw new ProductionError("Employee not found");
  const open = await db
    .select({ id: laborEntries.id })
    .from(laborEntries)
    .where(and(eq(laborEntries.employeeId, emp.id), sql`${laborEntries.endedAt} is null`));
  if (open.length) throw new ProductionError(`${emp.name} is already clocked in; clock out first`);
  const [entry] = await db
    .insert(laborEntries)
    .values({ orgId: actor.orgId, workOrderOperationId: op.id, employeeId: emp.id, hourlyRate: Number(emp.hourlyRate) })
    .returning();
  await db.update(workOrderOperations).set({ status: "in_progress", updatedAt: new Date() }).where(eq(workOrderOperations.id, op.id));
  await markInProgress(db, wo);
  return entry;
}

/** Clock out: hours * rate posts WIP / Labour absorbed and lands on the job. */
export async function clockOut(
  db: DbOrTx,
  actor: Actor,
  input: { laborEntryId: string; qtyGood?: number; qtyScrap?: number; scrapReason?: string | null; notes?: string | null; endedAt?: Date; operationComplete?: boolean },
) {
  const [entry] = await db.select().from(laborEntries).where(and(eq(laborEntries.id, input.laborEntryId), eq(laborEntries.orgId, actor.orgId)));
  if (!entry) throw new ProductionError("Labour entry not found");
  if (entry.endedAt) throw new ProductionError("Already clocked out");
  const endedAt = input.endedAt ?? new Date();
  const hours = round4(Math.max(0, (endedAt.getTime() - entry.startedAt.getTime()) / 3_600_000));
  const result = await finishLabor(db, actor, entry, { hours, endedAt, qtyGood: input.qtyGood ?? 0, qtyScrap: input.qtyScrap ?? 0, notes: input.notes, operationComplete: input.operationComplete });
  if (input.scrapReason && (input.qtyScrap ?? 0) > 0) await db.update(laborEntries).set({ scrapReason: input.scrapReason }).where(eq(laborEntries.id, entry.id));
  return result;
}

/** Manual time entry (paper timesheet, supervisor correction). */
export async function recordLabor(
  db: DbOrTx,
  actor: Actor,
  input: { operationId: string; employeeId: string; hours: number; qtyGood?: number; qtyScrap?: number; notes?: string | null; operationComplete?: boolean },
) {
  const [op] = await db.select().from(workOrderOperations).where(and(eq(workOrderOperations.id, input.operationId), eq(workOrderOperations.orgId, actor.orgId)));
  if (!op) throw new ProductionError("Operation not found");
  const wo = await getWo(db, actor.orgId, op.workOrderId);
  if (!["released", "in_progress"].includes(wo.status)) throw new ProductionError(`${wo.number} is ${wo.status}`);
  const [emp] = await db.select().from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.orgId, actor.orgId)));
  if (!emp) throw new ProductionError("Employee not found");
  const hours = round4(Number(input.hours));
  if (hours <= 0) throw new ProductionError("Hours must be positive");
  const now = new Date();
  const [entry] = await db
    .insert(laborEntries)
    .values({
      orgId: actor.orgId,
      workOrderOperationId: op.id,
      employeeId: emp.id,
      hourlyRate: Number(emp.hourlyRate),
      startedAt: new Date(now.getTime() - hours * 3_600_000),
    })
    .returning();
  await markInProgress(db, wo);
  return finishLabor(db, actor, entry, { hours, endedAt: now, qtyGood: input.qtyGood ?? 0, qtyScrap: input.qtyScrap ?? 0, notes: input.notes, operationComplete: input.operationComplete });
}

async function finishLabor(
  db: DbOrTx,
  actor: Actor,
  entry: typeof laborEntries.$inferSelect,
  input: { hours: number; endedAt: Date; qtyGood: number; qtyScrap: number; notes?: string | null; operationComplete?: boolean },
) {
  const cost = round4(input.hours * Number(entry.hourlyRate));
  await db
    .update(laborEntries)
    .set({ endedAt: input.endedAt, hours: input.hours, qtyGood: input.qtyGood, qtyScrap: input.qtyScrap, notes: input.notes ?? null, updatedAt: new Date() })
    .where(eq(laborEntries.id, entry.id));
  const [op] = await db.select().from(workOrderOperations).where(eq(workOrderOperations.id, entry.workOrderOperationId));
  const wo = await getWo(db, actor.orgId, op.workOrderId);
  await db
    .update(workOrderOperations)
    .set({
      actualHours: round4(Number(op.actualHours) + input.hours),
      qtyComplete: round4(Number(op.qtyComplete) + input.qtyGood),
      qtyScrap: round4(Number(op.qtyScrap) + input.qtyScrap),
      status: input.operationComplete || Number(op.qtyComplete) + input.qtyGood >= Number(wo.qty) - 1e-9 ? "complete" : "in_progress",
      updatedAt: new Date(),
    })
    .where(eq(workOrderOperations.id, op.id));
  if (cost > 0) {
    await postEvent(db, { orgId: actor.orgId, event: "production.labor", amount: cost, date: today(), memo: `${wo.number} ${op.name} ${input.hours}h`, sourceType: "labor", sourceId: entry.id });
    await db.update(workOrders).set({ laborCost: sql`${workOrders.laborCost} + ${cost}`, updatedAt: new Date() }).where(eq(workOrders.id, wo.id));
  }
  return { hours: input.hours, cost };
}

/**
 * Complete a work order: apply overhead, write off scrap, and move the good
 * units into stock at their actual cost (WIP is relieved to zero).
 */
export async function completeWorkOrder(
  db: DbOrTx,
  actor: Actor,
  input: { workOrderId: string; qtyGood: number; qtyScrap?: number; scrapReason?: string | null; locationId: string; lotNumber?: string | null; overheadPct?: number },
) {
  const wo = await getWo(db, actor.orgId, input.workOrderId);
  if (!["released", "in_progress"].includes(wo.status)) throw new ProductionError(`${wo.number} is ${wo.status}`);
  const good = round4(Number(input.qtyGood));
  const scrap = round4(Number(input.qtyScrap ?? 0));
  if (good <= 0 && scrap <= 0) throw new ProductionError("Report a good or scrapped quantity");
  const [loc] = await db.select().from(locations).where(and(eq(locations.id, input.locationId), eq(locations.orgId, actor.orgId)));
  if (!loc) throw new ProductionError("Location not found");

  const overhead = round4((Number(wo.laborCost) * Number(input.overheadPct ?? 0)) / 100 - Number(wo.overheadCost));
  if (overhead > 0) {
    await postEvent(db, { orgId: actor.orgId, event: "production.overhead", amount: overhead, date: today(), memo: `${wo.number} overhead`, sourceType: "wo", sourceId: wo.id });
  }
  const totalCost = round4(Number(wo.materialCost) + Number(wo.laborCost) + Number(wo.outsideCost) + Number(wo.overheadCost) + Math.max(0, overhead));
  const units = good + scrap;
  const costPerUnit = units > 0 ? round4(totalCost / units) : 0;
  const scrapValue = round4(costPerUnit * scrap);
  let goodValue = round4(totalCost - scrapValue);
  if (good <= 0) goodValue = 0;
  if (scrapValue > 0) {
    await postEvent(db, { orgId: actor.orgId, event: "production.scrap", amount: scrapValue, date: today(), memo: `${wo.number} scrap ${scrap}`, sourceType: "wo", sourceId: wo.id });
  }
  if (good > 0) {
    await moveStock(db, {
      orgId: actor.orgId,
      userId: actor.userId,
      itemId: wo.itemId,
      locationId: loc.id,
      qty: good,
      unitCost: round4(goodValue / good),
      type: "complete",
      lotNumber: input.lotNumber ?? wo.number,
      refType: "wo",
      refId: wo.id,
      memo: `${wo.number} complete`,
      glEvent: "production.complete",
    });
  }
  await db
    .update(workOrders)
    .set({
      status: "complete",
      qtyComplete: round4(Number(wo.qtyComplete) + good),
      qtyScrap: round4(Number(wo.qtyScrap) + scrap),
      overheadCost: round4(Number(wo.overheadCost) + Math.max(0, overhead)),
      scrapReason: scrap > 0 ? (input.scrapReason ?? wo.scrapReason) : wo.scrapReason,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(workOrders.id, wo.id));
  await db.update(workOrderOperations).set({ status: "complete" }).where(eq(workOrderOperations.workOrderId, wo.id));
  if (wo.salesOrderLineId) {
    const [line] = await db.select().from(salesOrderLines).where(eq(salesOrderLines.id, wo.salesOrderLineId));
    if (line) await recomputeOrderStatus(db, actor.orgId, line.orderId);
  }
  await audit(db, { ...actor, action: "wo.complete", entityType: "wo", entityId: wo.id, data: { good, scrap, totalCost } });
  return { good, scrap, totalCost, unitCost: good > 0 ? round4(goodValue / good) : 0 };
}

export async function cancelWorkOrder(db: DbOrTx, actor: Actor, workOrderId: string) {
  const wo = await getWo(db, actor.orgId, workOrderId);
  if (Number(wo.materialCost) + Number(wo.laborCost) > 0) throw new ProductionError("Work orders with cost on them must be completed, not cancelled");
  await db.update(workOrders).set({ status: "cancelled", updatedAt: new Date() }).where(eq(workOrders.id, wo.id));
}

/** The schedule board: open operations per work centre with load vs capacity. */
export async function scheduleBoard(db: DbOrTx, orgId: string) {
  const centers = await db.select().from(workCenters).where(and(eq(workCenters.orgId, orgId), eq(workCenters.active, true))).orderBy(asc(workCenters.code));
  const ops = await db
    .select({
      op: workOrderOperations,
      woNumber: workOrders.number,
      woId: workOrders.id,
      woStatus: workOrders.status,
      dueDate: workOrders.dueDate,
      priority: workOrders.priority,
      woQty: workOrders.qty,
      sku: items.sku,
      itemName: items.name,
    })
    .from(workOrderOperations)
    .innerJoin(workOrders, eq(workOrders.id, workOrderOperations.workOrderId))
    .innerJoin(items, eq(items.id, workOrders.itemId))
    .where(and(eq(workOrderOperations.orgId, orgId), inArray(workOrders.status, ["released", "in_progress"]), inArray(workOrderOperations.status, ["pending", "in_progress"])))
    .orderBy(asc(workOrders.priority), asc(workOrders.dueDate), asc(workOrderOperations.seq));
  return centers.map((wc) => {
    const mine = ops.filter((o) => o.op.workCenterId === wc.id);
    const loadHours = round4(mine.reduce((s, o) => s + Math.max(0, Number(o.op.plannedSetupHours) + Number(o.op.plannedRunHours) - Number(o.op.actualHours)), 0));
    const daysOfWork = Number(wc.capacityHoursPerDay) > 0 ? round4(loadHours / Number(wc.capacityHoursPerDay)) : 0;
    return { workCenter: wc, operations: mine, loadHours, daysOfWork };
  });
}

export async function listWorkOrders(db: DbOrTx, orgId: string, statuses?: string[], q?: string) {
  const conds = [eq(workOrders.orgId, orgId)];
  if (statuses?.length) conds.push(inArray(workOrders.status, statuses as (typeof workOrders.status.enumValues)[number][]));
  if (q) conds.push(or(ilike(workOrders.number, `%${q}%`), ilike(items.sku, `%${q}%`), ilike(items.name, `%${q}%`))!);
  return db
    .select({
      id: workOrders.id,
      number: workOrders.number,
      status: workOrders.status,
      qty: workOrders.qty,
      qtyComplete: workOrders.qtyComplete,
      dueDate: workOrders.dueDate,
      priority: workOrders.priority,
      sku: items.sku,
      itemName: items.name,
      materialCost: workOrders.materialCost,
      laborCost: workOrders.laborCost,
      outsideCost: workOrders.outsideCost,
      overheadCost: workOrders.overheadCost,
      salesOrderLineId: workOrders.salesOrderLineId,
    })
    .from(workOrders)
    .innerJoin(items, eq(items.id, workOrders.itemId))
    .where(and(...conds))
    .orderBy(asc(workOrders.priority), asc(workOrders.dueDate), desc(workOrders.number));
}

/** Planning fields on a work order: priority, dates, notes, and quantity while still planned. */
export async function updateWorkOrder(
  db: DbOrTx,
  actor: Actor,
  workOrderId: string,
  patch: { priority?: number | null; dueDate?: string | null; scheduledStart?: string | null; scheduledEnd?: string | null; notes?: string | null; qty?: number | null },
) {
  const wo = await getWo(db, actor.orgId, workOrderId);
  if (["complete", "closed", "cancelled"].includes(wo.status)) throw new ProductionError(`${wo.number} is ${wo.status}`);
  if (patch.qty != null && Number(patch.qty) !== Number(wo.qty)) {
    if (wo.status !== "planned") throw new ProductionError("Quantity can only change while the work order is planned");
    const ratio = Number(patch.qty) / Number(wo.qty);
    const mats = await db.select().from(workOrderMaterials).where(eq(workOrderMaterials.workOrderId, wo.id));
    for (const m of mats) await db.update(workOrderMaterials).set({ qtyRequired: round4(Number(m.qtyRequired) * ratio) }).where(eq(workOrderMaterials.id, m.id));
    const ops = await db.select().from(workOrderOperations).where(eq(workOrderOperations.workOrderId, wo.id));
    for (const o of ops) await db.update(workOrderOperations).set({ plannedRunHours: round4(Number(o.plannedRunHours) * ratio) }).where(eq(workOrderOperations.id, o.id));
  }
  await db
    .update(workOrders)
    .set({
      priority: patch.priority ?? wo.priority,
      dueDate: patch.dueDate === undefined ? wo.dueDate : patch.dueDate,
      scheduledStart: patch.scheduledStart === undefined ? wo.scheduledStart : patch.scheduledStart,
      scheduledEnd: patch.scheduledEnd === undefined ? wo.scheduledEnd : patch.scheduledEnd,
      notes: patch.notes === undefined ? wo.notes : patch.notes,
      qty: patch.qty != null ? Number(patch.qty) : wo.qty,
      updatedAt: new Date(),
    })
    .where(eq(workOrders.id, wo.id));
  await audit(db, { ...actor, action: "wo.update", entityType: "wo", entityId: wo.id, data: patch });
}

/** Material availability for a work order: what is still needed and whether stock covers it. */
export async function materialAvailability(db: DbOrTx, orgId: string, workOrderId: string) {
  const mats = await db
    .select({ m: workOrderMaterials, sku: items.sku, name: items.name, type: items.type })
    .from(workOrderMaterials)
    .innerJoin(items, eq(items.id, workOrderMaterials.itemId))
    .where(and(eq(workOrderMaterials.orgId, orgId), eq(workOrderMaterials.workOrderId, workOrderId)));
  const out = [];
  for (const r of mats) {
    const stock = await onHand(db, orgId, r.m.itemId);
    const remaining = round4(Number(r.m.qtyRequired) - Number(r.m.qtyIssued));
    out.push({ ...r, onHand: stock, remaining, short: round4(Math.max(0, remaining - stock)) });
  }
  return out;
}
