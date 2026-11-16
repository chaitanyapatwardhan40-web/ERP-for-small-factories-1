import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "@/lib/db";
import { bomLines, bomRevisions, items, orgs, routingOperations, routings, workCenters } from "@/lib/db/schema";
import { explodeForWorkOrder, rollUpCost } from "./service";

let db: Db;
let orgId: string;
let otherOrgId: string;
const ids: Record<string, string> = {};

async function item(sku: string, type: "make" | "buy" | "phantom", standardCost = 0, org = orgId) {
  const [row] = await db
    .insert(items)
    .values({ orgId: org, sku, name: sku, type, standardCost })
    .returning();
  ids[sku] = row.id;
  return row.id;
}

beforeAll(async () => {
  db = await createTestDb();
  const [org] = await db.insert(orgs).values({ name: "Test Shop", slug: "test" }).returning();
  const [other] = await db.insert(orgs).values({ name: "Other", slug: "other" }).returning();
  orgId = org.id;
  otherOrgId = other.id;

  // Level 0: KIT (make) = 1 x ASSY (make) + 2 x BRACKET (buy $3) + 1 x HW-PACK (phantom)
  // Level 1: ASSY (make) = 1 x PLATE (buy $10) + 4 x SCREW (buy $0.05)
  // Phantom: HW-PACK = 10 x SCREW
  await item("KIT", "make");
  await item("ASSY", "make");
  await item("BRACKET", "buy", 3);
  await item("PLATE", "buy", 10);
  await item("SCREW", "buy", 0.05);
  await item("HW-PACK", "phantom");

  const [wc] = await db
    .insert(workCenters)
    .values({ orgId, code: "ASM", name: "Assembly", hourlyRate: 60 })
    .returning();

  const bom = async (parent: string, lines: [string, number, number?][]) => {
    const [rev] = await db
      .insert(bomRevisions)
      .values({ orgId, itemId: ids[parent], rev: "A", status: "active" })
      .returning();
    await db.insert(bomLines).values(
      lines.map(([c, q, scrap], i) => ({
        orgId,
        bomRevisionId: rev.id,
        componentItemId: ids[c],
        qty: q,
        scrapPct: scrap ?? 0,
        position: (i + 1) * 10,
      })),
    );
  };
  await bom("KIT", [["ASSY", 1], ["BRACKET", 2], ["HW-PACK", 1]]);
  await bom("ASSY", [["PLATE", 1], ["SCREW", 4, 10]]);
  await bom("HW-PACK", [["SCREW", 10]]);

  const routing = async (parent: string, ops: [string, number, number][]) => {
    const [r] = await db
      .insert(routings)
      .values({ orgId, itemId: ids[parent], rev: "A", status: "active" })
      .returning();
    await db.insert(routingOperations).values(
      ops.map(([name, setup, run], i) => ({
        orgId,
        routingId: r.id,
        seq: (i + 1) * 10,
        name,
        workCenterId: wc.id,
        setupHours: setup,
        runHoursPerUnit: run,
      })),
    );
  };
  // KIT: 0.5h setup + 0.25h/unit at $60 -> lot of 1: 0.75h = $45
  await routing("KIT", [["Kit & pack", 0.5, 0.25]]);
  // ASSY: 0h setup + 0.1h/unit -> $6
  await routing("ASSY", [["Assemble", 0, 0.1]]);
});

describe("cost roll-up", () => {
  it("rolls a 3-level BOM with scrap, phantoms, routing and overhead to the cent", async () => {
    // ASSY material: PLATE 10 + SCREW 4 * 1.10 * 0.05 = 10.22 ; labour 6 ; total 16.22
    const assy = await rollUpCost(db, orgId, ids.ASSY, { overheadPct: 0 });
    expect(assy.material).toBeCloseTo(10.22, 4);
    expect(assy.labor).toBeCloseTo(6, 4);
    expect(assy.total).toBeCloseTo(16.22, 4);

    // With 20% overhead the sub-assembly carries its own overhead (6 * 20% = 1.20):
    // KIT material: ASSY 17.42 + 2 * BRACKET 3 + HW-PACK (10 screws = 0.50) = 23.92
    // labour 45, overhead 20% of labour = 9 ; total 77.92
    const kit = await rollUpCost(db, orgId, ids.KIT, { overheadPct: 20 });
    expect(kit.material).toBeCloseTo(23.92, 4);
    expect(kit.labor).toBeCloseTo(45, 4);
    expect(kit.overhead).toBeCloseTo(9, 4);
    expect(kit.total).toBeCloseTo(77.92, 4);
  });

  it("amortises setup over the lot size", async () => {
    const kit10 = await rollUpCost(db, orgId, ids.KIT, { overheadPct: 0 }, 10);
    // 0.25 + 0.5/10 = 0.30h * 60 = 18
    expect(kit10.labor).toBeCloseTo(18, 4);
  });

  it("explodes a work order through phantoms and merges duplicate parts", async () => {
    const lines = await explodeForWorkOrder(db, orgId, ids.KIT, 5);
    const byItem = Object.fromEntries(lines.map((l) => [l.itemId, l.qty]));
    expect(byItem[ids.ASSY]).toBe(5);
    expect(byItem[ids.BRACKET]).toBe(10);
    expect(byItem[ids.SCREW]).toBe(50); // phantom flattened: 5 kits * 10 screws
    expect(byItem[ids["HW-PACK"]]).toBeUndefined();
  });

  it("keeps tenants apart: another org cannot see or cost this BOM", async () => {
    await expect(rollUpCost(db, otherOrgId, ids.KIT)).rejects.toThrow("Item not found");
    const lines = await explodeForWorkOrder(db, otherOrgId, ids.KIT, 1);
    expect(lines).toEqual([]);
  });
});
