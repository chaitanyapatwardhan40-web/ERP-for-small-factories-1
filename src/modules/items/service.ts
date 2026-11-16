import { and, asc, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import {
  bomLines,
  bomRevisions,
  items,
  routingOperations,
  routings,
  workCenters,
} from "@/lib/db/schema";
import { round4 } from "@/lib/money";

export type CostBreakdown = {
  material: number;
  labor: number;
  outside: number;
  overhead: number;
  total: number;
};

export type OverheadPolicy = { overheadPct: number };

/** The active BOM revision for an item, or the latest draft if none is active. */
export async function activeBom(db: DbOrTx, orgId: string, itemId: string) {
  const revs = await db
    .select()
    .from(bomRevisions)
    .where(and(eq(bomRevisions.orgId, orgId), eq(bomRevisions.itemId, itemId)))
    .orderBy(asc(bomRevisions.createdAt));
  return revs.find((r) => r.status === "active") ?? revs.at(-1) ?? null;
}

export async function activeRouting(db: DbOrTx, orgId: string, itemId: string) {
  const revs = await db
    .select()
    .from(routings)
    .where(and(eq(routings.orgId, orgId), eq(routings.itemId, itemId)))
    .orderBy(asc(routings.createdAt));
  return revs.find((r) => r.status === "active") ?? revs.at(-1) ?? null;
}

/** Labour + outside cost per unit from the routing (setup amortised over lotSize). */
export async function routingCostPerUnit(
  db: DbOrTx,
  orgId: string,
  itemId: string,
  lotSize = 1,
): Promise<{ labor: number; outside: number; hoursPerUnit: number }> {
  const routing = await activeRouting(db, orgId, itemId);
  if (!routing) return { labor: 0, outside: 0, hoursPerUnit: 0 };
  const ops = await db
    .select({
      setupHours: routingOperations.setupHours,
      runHoursPerUnit: routingOperations.runHoursPerUnit,
      outsideCostPerUnit: routingOperations.outsideCostPerUnit,
      rate: workCenters.hourlyRate,
    })
    .from(routingOperations)
    .leftJoin(workCenters, eq(workCenters.id, routingOperations.workCenterId))
    .where(eq(routingOperations.routingId, routing.id));
  let labor = 0;
  let outside = 0;
  let hours = 0;
  const lot = Math.max(1, lotSize);
  for (const op of ops) {
    const hoursPerUnit = Number(op.runHoursPerUnit) + Number(op.setupHours) / lot;
    hours += hoursPerUnit;
    labor += hoursPerUnit * Number(op.rate ?? 0);
    outside += Number(op.outsideCostPerUnit);
  }
  return { labor: round4(labor), outside: round4(outside), hoursPerUnit: round4(hours) };
}

/**
 * Rolled-up standard cost of one unit, recursing through make items.
 * Buy items contribute their standard cost (or last cost when standard is 0).
 * Overhead is applied as a percentage of labour (the shop's policy).
 */
export async function rollUpCost(
  db: DbOrTx,
  orgId: string,
  itemId: string,
  policy: OverheadPolicy = { overheadPct: 0 },
  lotSize = 1,
  seen: Set<string> = new Set(),
): Promise<CostBreakdown> {
  if (seen.has(itemId)) throw new Error("BOM loop detected");
  seen.add(itemId);
  const [item] = await db
    .select()
    .from(items)
    .where(and(eq(items.orgId, orgId), eq(items.id, itemId)));
  if (!item) throw new Error("Item not found");

  if (item.type === "buy" || item.type === "service") {
    const unit = Number(item.standardCost) || Number(item.lastCost) || Number(item.avgCost) || 0;
    return { material: round4(unit), labor: 0, outside: 0, overhead: 0, total: round4(unit) };
  }

  const bom = await activeBom(db, orgId, itemId);
  let material = 0;
  let labor = 0;
  let outside = 0;
  let overhead = 0;
  if (bom) {
    const lines = await db.select().from(bomLines).where(eq(bomLines.bomRevisionId, bom.id));
    for (const line of lines) {
      const child = await rollUpCost(db, orgId, line.componentItemId, policy, lotSize, new Set(seen));
      const qtyWithScrap = Number(line.qty) * (1 + Number(line.scrapPct) / 100);
      // A sub-assembly's full cost rolls into the parent's material cost.
      material += child.total * qtyWithScrap;
    }
  }
  if (item.type === "make") {
    const r = await routingCostPerUnit(db, orgId, itemId, lotSize);
    labor = r.labor;
    outside = r.outside;
    overhead = round4((labor * policy.overheadPct) / 100);
  }
  const total = round4(material + labor + outside + overhead);
  return { material: round4(material), labor, outside, overhead, total };
}

export type ExplodedLine = { itemId: string; qty: number; level: number };

/**
 * Single-level explosion of what a work order needs: direct components, with
 * phantom sub-assemblies flattened into their parts.
 */
export async function explodeForWorkOrder(
  db: DbOrTx,
  orgId: string,
  itemId: string,
  qty: number,
  level = 0,
): Promise<ExplodedLine[]> {
  const bom = await activeBom(db, orgId, itemId);
  if (!bom) return [];
  const lines = await db.select().from(bomLines).where(eq(bomLines.bomRevisionId, bom.id));
  const out: ExplodedLine[] = [];
  const comps = lines.length
    ? await db.select().from(items).where(inArray(items.id, lines.map((l) => l.componentItemId)))
    : [];
  for (const line of lines) {
    const comp = comps.find((c) => c.id === line.componentItemId);
    const need = round4(qty * Number(line.qty) * (1 + Number(line.scrapPct) / 100));
    if (comp?.type === "phantom") {
      out.push(...(await explodeForWorkOrder(db, orgId, comp.id, need, level + 1)));
    } else {
      out.push({ itemId: line.componentItemId, qty: need, level });
    }
  }
  // Merge duplicates (same part used in two places).
  const merged = new Map<string, ExplodedLine>();
  for (const l of out) {
    const m = merged.get(l.itemId);
    if (m) m.qty = round4(m.qty + l.qty);
    else merged.set(l.itemId, { ...l });
  }
  return [...merged.values()];
}

/** Parents that use a component (where-used). */
export async function whereUsed(db: DbOrTx, orgId: string, componentItemId: string) {
  return db
    .select({
      parentId: bomRevisions.itemId,
      parentSku: items.sku,
      parentName: items.name,
      rev: bomRevisions.rev,
      status: bomRevisions.status,
      qty: bomLines.qty,
    })
    .from(bomLines)
    .innerJoin(bomRevisions, eq(bomRevisions.id, bomLines.bomRevisionId))
    .innerJoin(items, eq(items.id, bomRevisions.itemId))
    .where(and(eq(bomLines.orgId, orgId), eq(bomLines.componentItemId, componentItemId)));
}

/** Recompute and store standard cost for one item. */
export async function refreshStandardCost(
  db: DbOrTx,
  orgId: string,
  itemId: string,
  policy: OverheadPolicy,
) {
  const cost = await rollUpCost(db, orgId, itemId, policy);
  await db.update(items).set({ standardCost: cost.total, updatedAt: new Date() }).where(eq(items.id, itemId));
  return cost;
}
