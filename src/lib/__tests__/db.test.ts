import { describe, expect, it } from "vitest";
import { createTestDb } from "@/lib/db";
import { orgs } from "@/lib/db/schema";
import { nextNumber } from "@/lib/numbering";

describe("database", () => {
  it("migrates and numbers documents per org", async () => {
    const db = await createTestDb();
    const [a] = await db.insert(orgs).values({ name: "A", slug: "a" }).returning();
    const [b] = await db.insert(orgs).values({ name: "B", slug: "b" }).returning();
    expect(await nextNumber(db, a.id, "order")).toBe("SO-00001");
    expect(await nextNumber(db, a.id, "order")).toBe("SO-00002");
    expect(await nextNumber(db, b.id, "order")).toBe("SO-00001");
    expect(await nextNumber(db, a.id, "wo")).toBe("WO-00001");
  });
});
