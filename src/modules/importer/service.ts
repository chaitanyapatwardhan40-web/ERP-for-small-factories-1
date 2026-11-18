import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { bomLines, bomRevisions, customers, employees, items, locations, vendors, workCenters } from "@/lib/db/schema";
import { nextNumber } from "@/lib/numbering";
import { moveStock } from "@/modules/inventory/service";
import { ENTITIES, inferItemType, type EntityKind, type Mapping } from "./mapping";
import { toNumber } from "./parse";

export type ImportResult = { created: number; updated: number; skipped: number; errors: string[] };

type Actor = { orgId: string; userId: string };

const get = (row: Record<string, string>, mapping: Mapping, key: string) => {
  const h = mapping[key];
  return h ? row[h]?.trim() || undefined : undefined;
};

/**
 * Import loading: write rows into the system idempotently.
 * Existing records (by code / SKU / name) are updated, not duplicated, so a
 * shop can re-import a corrected sheet without fear.
 */
export async function runImport(db: DbOrTx, actor: Actor, kind: EntityKind, mapping: Mapping, rows: Record<string, string>[]): Promise<ImportResult> {
  const res: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const def = ENTITIES[kind];
  for (const f of def.fields) if (f.required && !mapping[f.key]) throw new Error(`Map the "${f.label}" column first`);

  let n = 0;
  for (const row of rows) {
    n++;
    try {
      if (kind === "customers" || kind === "vendors") {
        const name = get(row, mapping, "name");
        if (!name) {
          res.skipped++;
          continue;
        }
        const table = kind === "customers" ? customers : vendors;
        const code = get(row, mapping, "code");
        const [existing] = await db
          .select()
          .from(table)
          .where(and(eq(table.orgId, actor.orgId), code ? eq(table.code, code) : eq(table.name, name)));
        const addr = { line1: get(row, mapping, "line1"), city: get(row, mapping, "city"), state: get(row, mapping, "state"), postalCode: get(row, mapping, "postalCode") };
        const hasAddr = Object.values(addr).some(Boolean);
        const common = {
          name,
          email: get(row, mapping, "email") ?? null,
          phone: get(row, mapping, "phone") ?? null,
          termsDays: toNumber(get(row, mapping, "termsDays")) ?? 30,
          updatedAt: new Date(),
        };
        if (kind === "customers") {
          const values = { ...common, notes: get(row, mapping, "notes") ?? null, billingAddress: hasAddr ? addr : null };
          if (existing) {
            await db.update(customers).set(values).where(eq(customers.id, existing.id));
            res.updated++;
          } else {
            await db.insert(customers).values({ orgId: actor.orgId, code: code ?? (await nextNumber(db, actor.orgId, "customer")), ...values });
            res.created++;
          }
        } else {
          const values = { ...common, leadTimeDays: toNumber(get(row, mapping, "leadTimeDays")) ?? 14, address: hasAddr ? addr : null };
          if (existing) {
            await db.update(vendors).set(values).where(eq(vendors.id, existing.id));
            res.updated++;
          } else {
            await db.insert(vendors).values({ orgId: actor.orgId, code: code ?? (await nextNumber(db, actor.orgId, "vendor")), ...values });
            res.created++;
          }
        }
      } else if (kind === "items") {
        const sku = get(row, mapping, "sku");
        const name = get(row, mapping, "name") ?? sku;
        if (!sku || !name) {
          res.skipped++;
          continue;
        }
        const vendorName = get(row, mapping, "vendor");
        let preferredVendorId: string | null = null;
        if (vendorName) {
          const [v] = await db.select().from(vendors).where(and(eq(vendors.orgId, actor.orgId), eq(vendors.name, vendorName)));
          preferredVendorId = v?.id ?? null;
        }
        const type = inferItemType(row, name, get(row, mapping, "type"));
        const values = {
          name,
          type,
          uom: (get(row, mapping, "uom") ?? "ea").toLowerCase(),
          standardCost: toNumber(get(row, mapping, "standardCost")) ?? 0,
          salesPrice: toNumber(get(row, mapping, "salesPrice")) ?? 0,
          reorderPoint: toNumber(get(row, mapping, "reorderPoint")) ?? 0,
          reorderQty: toNumber(get(row, mapping, "reorderQty")) ?? 0,
          leadTimeDays: Math.round(toNumber(get(row, mapping, "leadTimeDays")) ?? 0),
          preferredVendorId,
          drawingNumber: get(row, mapping, "drawingNumber") ?? null,
          revision: get(row, mapping, "revision") ?? "A",
          updatedAt: new Date(),
        };
        const [existing] = await db.select().from(items).where(and(eq(items.orgId, actor.orgId), eq(items.sku, sku)));
        let itemId: string;
        if (existing) {
          await db.update(items).set(values).where(eq(items.id, existing.id));
          itemId = existing.id;
          res.updated++;
        } else {
          const [created] = await db.insert(items).values({ orgId: actor.orgId, sku, ...values }).returning();
          itemId = created.id;
          res.created++;
        }
        const onHand = toNumber(get(row, mapping, "onHand"));
        if (onHand && onHand > 0 && !existing) {
          const [loc] = await db.select().from(locations).where(and(eq(locations.orgId, actor.orgId), eq(locations.type, "stock")));
          if (loc) {
            await moveStock(db, { orgId: actor.orgId, userId: actor.userId, itemId, locationId: loc.id, qty: onHand, unitCost: values.standardCost, type: "receipt", refType: "import", memo: "Opening stock from import", glEvent: "inventory.opening" });
          }
        }
      } else if (kind === "bom") {
        const parentSku = get(row, mapping, "parentSku");
        const componentSku = get(row, mapping, "componentSku");
        const qty = toNumber(get(row, mapping, "qty")) ?? 1;
        if (!parentSku || !componentSku) {
          res.skipped++;
          continue;
        }
        const [parent] = await db.select().from(items).where(and(eq(items.orgId, actor.orgId), eq(items.sku, parentSku)));
        const [comp] = await db.select().from(items).where(and(eq(items.orgId, actor.orgId), eq(items.sku, componentSku)));
        if (!parent) throw new Error(`parent ${parentSku} not found; import items first`);
        if (!comp) throw new Error(`component ${componentSku} not found; import items first`);
        if (parent.type === "buy") await db.update(items).set({ type: "make" }).where(eq(items.id, parent.id));
        const rev = get(row, mapping, "rev") ?? "A";
        let [bom] = await db.select().from(bomRevisions).where(and(eq(bomRevisions.orgId, actor.orgId), eq(bomRevisions.itemId, parent.id), eq(bomRevisions.rev, rev)));
        if (!bom) [bom] = await db.insert(bomRevisions).values({ orgId: actor.orgId, itemId: parent.id, rev, status: "active" }).returning();
        const [line] = await db.select().from(bomLines).where(and(eq(bomLines.bomRevisionId, bom.id), eq(bomLines.componentItemId, comp.id)));
        const scrapPct = toNumber(get(row, mapping, "scrapPct")) ?? 0;
        if (line) {
          await db.update(bomLines).set({ qty, scrapPct, updatedAt: new Date() }).where(eq(bomLines.id, line.id));
          res.updated++;
        } else {
          const count = await db.select().from(bomLines).where(eq(bomLines.bomRevisionId, bom.id));
          await db.insert(bomLines).values({ orgId: actor.orgId, bomRevisionId: bom.id, componentItemId: comp.id, qty, scrapPct, position: (count.length + 1) * 10 });
          res.created++;
        }
      } else if (kind === "work_centers") {
        const code = get(row, mapping, "code");
        if (!code) {
          res.skipped++;
          continue;
        }
        const values = { name: get(row, mapping, "name") ?? code, hourlyRate: toNumber(get(row, mapping, "hourlyRate")) ?? 0, capacityHoursPerDay: toNumber(get(row, mapping, "capacityHoursPerDay")) ?? 8, updatedAt: new Date() };
        const [existing] = await db.select().from(workCenters).where(and(eq(workCenters.orgId, actor.orgId), eq(workCenters.code, code)));
        if (existing) {
          await db.update(workCenters).set(values).where(eq(workCenters.id, existing.id));
          res.updated++;
        } else {
          await db.insert(workCenters).values({ orgId: actor.orgId, code, ...values });
          res.created++;
        }
      } else if (kind === "stock") {
        const sku = get(row, mapping, "sku");
        const qty = toNumber(get(row, mapping, "qty"));
        if (!sku || !qty) {
          res.skipped++;
          continue;
        }
        const [item] = await db.select().from(items).where(and(eq(items.orgId, actor.orgId), eq(items.sku, sku)));
        if (!item) throw new Error(`${sku} not found; import items first`);
        const locCode = get(row, mapping, "location");
        let [loc] = locCode
          ? await db.select().from(locations).where(and(eq(locations.orgId, actor.orgId), eq(locations.code, locCode)))
          : await db.select().from(locations).where(and(eq(locations.orgId, actor.orgId), eq(locations.type, "stock")));
        if (!loc && locCode) [loc] = await db.insert(locations).values({ orgId: actor.orgId, code: locCode, name: locCode, type: "stock" }).returning();
        if (!loc) throw new Error("no stock location");
        await moveStock(db, {
          orgId: actor.orgId,
          userId: actor.userId,
          itemId: item.id,
          locationId: loc.id,
          qty,
          unitCost: toNumber(get(row, mapping, "unitCost")) ?? Number(item.standardCost) ?? 0,
          type: "receipt",
          lotNumber: get(row, mapping, "lot") ?? null,
          refType: "import",
          memo: "Opening count from import",
          glEvent: "inventory.opening",
        });
        res.created++;
      } else if (kind === "employees") {
        const name = get(row, mapping, "name");
        if (!name) {
          res.skipped++;
          continue;
        }
        const values = {
          badge: get(row, mapping, "badge") ?? null,
          hourlyRate: toNumber(get(row, mapping, "hourlyRate")) ?? 0,
          skills: (get(row, mapping, "skills") ?? "").split(/[,;]/).map((s) => s.trim()).filter(Boolean),
          updatedAt: new Date(),
        };
        const [existing] = await db.select().from(employees).where(and(eq(employees.orgId, actor.orgId), eq(employees.name, name)));
        if (existing) {
          await db.update(employees).set(values).where(eq(employees.id, existing.id));
          res.updated++;
        } else {
          await db.insert(employees).values({ orgId: actor.orgId, name, ...values });
          res.created++;
        }
      }
    } catch (e) {
      res.errors.push(`Row ${n}: ${e instanceof Error ? e.message : String(e)}`);
      if (res.errors.length > 50) break;
    }
  }
  return res;
}
