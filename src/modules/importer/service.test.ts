import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type Db } from "@/lib/db";
import { items, locations, orgs, users } from "@/lib/db/schema";
import { seedBooks } from "@/modules/books/service";
import { onHand } from "@/modules/inventory/service";
import { rollUpCost } from "@/modules/items/service";
import { guessEntity, heuristicMapping } from "./mapping";
import { parseSpreadsheet } from "./parse";
import { runImport } from "./service";

let db: Db;
let actor: { orgId: string; userId: string };

beforeAll(async () => {
  db = await createTestDb();
  const [org] = await db.insert(orgs).values({ name: "Import Shop", slug: "import" }).returning();
  const [user] = await db.insert(users).values({ email: "i@x.test", name: "I", passwordHash: "x" }).returning();
  actor = { orgId: org.id, userId: user.id };
  await seedBooks(db, org.id);
  await db.insert(locations).values({ orgId: org.id, code: "MAIN", name: "Main", type: "stock" });
});

describe("the implementer: messy spreadsheets in, configured system out", () => {
  it("recognises an item list with odd headers and maps the columns", () => {
    const csv = "Part #,Description,Make/Buy,U/M,Std Cost,Qty On Hand,Supplier\nKIT-100,Sensor kit assy,M,EA,$12.50,0,\nPLATE-1,Alum plate 6x6,B,ea,\"1,234.00\",40,Metal Supply\n";
    const [sheet] = parseSpreadsheet("items.csv", Buffer.from(csv));
    expect(sheet.headers).toEqual(["Part #", "Description", "Make/Buy", "U/M", "Std Cost", "Qty On Hand", "Supplier"]);
    expect(guessEntity(sheet.headers, sheet.rows)).toBe("items");
    const m = heuristicMapping("items", sheet.headers);
    expect(m.sku).toBe("Part #");
    expect(m.name).toBe("Description");
    expect(m.type).toBe("Make/Buy");
    expect(m.uom).toBe("U/M");
    expect(m.standardCost).toBe("Std Cost");
    expect(m.onHand).toBe("Qty On Hand");
    expect(m.vendor).toBe("Supplier");
  });

  it("imports items with opening stock, then a BOM that references them, idempotently", async () => {
    const itemsCsv = "Part #,Description,Make/Buy,U/M,Std Cost,Qty On Hand\nKIT-100,Sensor kit assy,M,EA,0,0\nPLATE-1,Alum plate 6x6,B,ea,\"1,234.00\",40\nSCREW-4,M4 screw,B,ea,0.05,1000\n";
    const [sheet] = parseSpreadsheet("items.csv", Buffer.from(itemsCsv));
    const r1 = await runImport(db, actor, "items", heuristicMapping("items", sheet.headers), sheet.rows);
    expect(r1).toMatchObject({ created: 3, updated: 0, errors: [] });
    const [plate] = await db.select().from(items).where(eq(items.sku, "PLATE-1"));
    expect(Number(plate.standardCost)).toBe(1234);
    expect(await onHand(db, actor.orgId, plate.id)).toBe(40);

    // Re-import the same file: updates, no duplicates, no double stock.
    const r2 = await runImport(db, actor, "items", heuristicMapping("items", sheet.headers), sheet.rows);
    expect(r2).toMatchObject({ created: 0, updated: 3 });
    expect(await onHand(db, actor.orgId, plate.id)).toBe(40);

    const bomCsv = "Assembly,Component,Qty Per,Scrap %\nKIT-100,PLATE-1,1,0\nKIT-100,SCREW-4,4,10\n";
    const [bom] = parseSpreadsheet("bom.csv", Buffer.from(bomCsv));
    expect(guessEntity(bom.headers, bom.rows)).toBe("bom");
    const r3 = await runImport(db, actor, "bom", heuristicMapping("bom", bom.headers), bom.rows);
    expect(r3).toMatchObject({ created: 2, errors: [] });
    const [kit] = await db.select().from(items).where(eq(items.sku, "KIT-100"));
    const cost = await rollUpCost(db, actor.orgId, kit.id);
    // 1234 + 4 * 1.10 * 0.05 = 1234.22
    expect(cost.total).toBeCloseTo(1234.22, 4);
  });

  it("reports row errors without aborting the rest", async () => {
    const bomCsv = "Assembly,Component,Qty Per\nKIT-100,NOPE-1,1\nKIT-100,PLATE-1,2\n";
    const [bom] = parseSpreadsheet("bom.csv", Buffer.from(bomCsv));
    const r = await runImport(db, actor, "bom", heuristicMapping("bom", bom.headers), bom.rows);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("NOPE-1");
    expect(r.updated).toBe(1);
  });
});
