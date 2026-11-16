import { and, desc, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { inventoryTransactions, items, locations, type TxnType } from "@/lib/db/schema";
import { round4 } from "@/lib/money";
import { postEvent } from "@/modules/books/service";

export class StockError extends Error {}

export async function onHand(db: DbOrTx, orgId: string, itemId: string, locationId?: string) {
  const conds = [eq(inventoryTransactions.orgId, orgId), eq(inventoryTransactions.itemId, itemId)];
  if (locationId) conds.push(eq(inventoryTransactions.locationId, locationId));
  const [row] = await db
    .select({ qty: sql<number>`coalesce(sum(${inventoryTransactions.qty}), 0)`.mapWith(Number) })
    .from(inventoryTransactions)
    .where(and(...conds));
  return round4(row?.qty ?? 0);
}

export type MoveInput = {
  orgId: string;
  userId?: string | null;
  itemId: string;
  locationId: string;
  /** Signed quantity. */
  qty: number;
  type: TxnType;
  /** Required for inbound movements that carry a cost (receipt, return). */
  unitCost?: number;
  lotNumber?: string | null;
  refType?: string;
  refId?: string;
  memo?: string;
  date?: string;
  /** Posting-rule event; omit for cost-neutral moves between locations. */
  glEvent?: string | null;
  allowNegative?: boolean;
};

/**
 * Record one stock movement. Inbound movements with a cost update the item's
 * moving weighted-average cost; outbound movements are valued at the current
 * average. When glEvent is given, the same transaction posts the ledger.
 */
export async function moveStock(db: DbOrTx, input: MoveInput) {
  const qty = round4(input.qty);
  if (qty === 0) throw new StockError("Quantity cannot be zero");
  const [item] = await db
    .select()
    .from(items)
    .where(and(eq(items.orgId, input.orgId), eq(items.id, input.itemId)));
  if (!item) throw new StockError("Item not found");
  const [loc] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.orgId, input.orgId), eq(locations.id, input.locationId)));
  if (!loc) throw new StockError("Location not found");

  const totalOnHand = await onHand(db, input.orgId, input.itemId);
  let unitCost: number;
  if (qty > 0 && input.unitCost !== undefined && input.type !== "move_in") {
    unitCost = round4(input.unitCost);
    const newQty = totalOnHand + qty;
    const newAvg =
      newQty > 0 && totalOnHand > 0
        ? (totalOnHand * Number(item.avgCost) + qty * unitCost) / newQty
        : unitCost;
    await db
      .update(items)
      .set({ avgCost: round4(newAvg), lastCost: unitCost, updatedAt: new Date() })
      .where(eq(items.id, item.id));
  } else {
    unitCost = round4(input.unitCost ?? Number(item.avgCost) ?? 0);
    if (qty < 0 && !input.allowNegative) {
      const here = await onHand(db, input.orgId, input.itemId, input.locationId);
      if (here + qty < -1e-9) {
        throw new StockError(`Only ${here} ${item.uom} of ${item.sku} on hand at this location`);
      }
    }
  }

  let journalEntryId: string | null = null;
  if (input.glEvent) {
    journalEntryId = await postEvent(db, {
      orgId: input.orgId,
      event: input.glEvent,
      amount: round4(Math.abs(qty) * unitCost),
      date: input.date ?? new Date().toISOString().slice(0, 10),
      memo: input.memo ?? `${item.sku} x ${qty}`,
      sourceType: input.refType,
      sourceId: input.refId,
    });
  }

  const [txn] = await db
    .insert(inventoryTransactions)
    .values({
      orgId: input.orgId,
      itemId: input.itemId,
      locationId: input.locationId,
      lotNumber: input.lotNumber ?? null,
      qty,
      unitCost,
      type: input.type,
      refType: input.refType,
      refId: input.refId,
      memo: input.memo,
      createdBy: input.userId ?? null,
      journalEntryId,
    })
    .returning();
  return { txn, unitCost, value: round4(Math.abs(qty) * unitCost) };
}

/** Transfer between two locations; cost-neutral, no ledger entry. */
export async function transferStock(
  db: DbOrTx,
  input: { orgId: string; userId?: string | null; itemId: string; fromLocationId: string; toLocationId: string; qty: number; lotNumber?: string | null; memo?: string },
) {
  const out = await moveStock(db, { ...input, locationId: input.fromLocationId, qty: -Math.abs(input.qty), type: "move_out", refType: "transfer" });
  await moveStock(db, { ...input, locationId: input.toLocationId, qty: Math.abs(input.qty), type: "move_in", unitCost: out.unitCost, refType: "transfer", refId: out.txn.id });
}

/** On-hand and ledger value per item. Value = sum(qty * unit cost) = GL inventory. */
export async function stockSummary(db: DbOrTx, orgId: string) {
  return db
    .select({
      itemId: items.id,
      sku: items.sku,
      name: items.name,
      type: items.type,
      uom: items.uom,
      avgCost: items.avgCost,
      reorderPoint: items.reorderPoint,
      reorderQty: items.reorderQty,
      onHand: sql<number>`coalesce(sum(${inventoryTransactions.qty}), 0)`.mapWith(Number),
      value: sql<number>`coalesce(sum(${inventoryTransactions.qty} * ${inventoryTransactions.unitCost}), 0)`.mapWith(Number),
    })
    .from(items)
    .leftJoin(
      inventoryTransactions,
      and(eq(inventoryTransactions.itemId, items.id), eq(inventoryTransactions.orgId, orgId)),
    )
    .where(eq(items.orgId, orgId))
    .groupBy(items.id)
    .orderBy(items.sku);
}

export async function stockByLocation(db: DbOrTx, orgId: string, itemId: string) {
  return db
    .select({
      locationId: locations.id,
      code: locations.code,
      name: locations.name,
      lotNumber: inventoryTransactions.lotNumber,
      onHand: sql<number>`coalesce(sum(${inventoryTransactions.qty}), 0)`.mapWith(Number),
    })
    .from(inventoryTransactions)
    .innerJoin(locations, eq(locations.id, inventoryTransactions.locationId))
    .where(and(eq(inventoryTransactions.orgId, orgId), eq(inventoryTransactions.itemId, itemId)))
    .groupBy(locations.id, inventoryTransactions.lotNumber)
    .having(sql`abs(sum(${inventoryTransactions.qty})) > 0.00001`);
}

export async function inventoryLedgerValue(db: DbOrTx, orgId: string) {
  const [row] = await db
    .select({
      value: sql<number>`coalesce(sum(${inventoryTransactions.qty} * ${inventoryTransactions.unitCost}), 0)`.mapWith(Number),
    })
    .from(inventoryTransactions)
    .where(eq(inventoryTransactions.orgId, orgId));
  return round4(row?.value ?? 0);
}

export async function recentTransactions(db: DbOrTx, orgId: string, limit = 100) {
  return db
    .select({
      id: inventoryTransactions.id,
      postedAt: inventoryTransactions.postedAt,
      sku: items.sku,
      itemName: items.name,
      location: locations.code,
      qty: inventoryTransactions.qty,
      unitCost: inventoryTransactions.unitCost,
      type: inventoryTransactions.type,
      refType: inventoryTransactions.refType,
      refId: inventoryTransactions.refId,
      lotNumber: inventoryTransactions.lotNumber,
      memo: inventoryTransactions.memo,
    })
    .from(inventoryTransactions)
    .innerJoin(items, eq(items.id, inventoryTransactions.itemId))
    .innerJoin(locations, eq(locations.id, inventoryTransactions.locationId))
    .where(eq(inventoryTransactions.orgId, orgId))
    .orderBy(desc(inventoryTransactions.postedAt))
    .limit(limit);
}
