import { and, asc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { customers, employees, items, locations, vendors } from "@/lib/db/schema";
import type { PickItem } from "@/components/forms/line-editor";

/** Lightweight lists for selects. Small shops have hundreds of items, not millions. */
export async function pickItems(db: DbOrTx, orgId: string): Promise<PickItem[]> {
  const rows = await db
    .select({ id: items.id, sku: items.sku, name: items.name, type: items.type, salesPrice: items.salesPrice, standardCost: items.standardCost, lastCost: items.lastCost, avgCost: items.avgCost })
    .from(items)
    .where(and(eq(items.orgId, orgId), eq(items.status, "active")))
    .orderBy(asc(items.sku));
  return rows.map((r) => ({ ...r, salesPrice: Number(r.salesPrice), standardCost: Number(r.standardCost), lastCost: Number(r.lastCost), avgCost: Number(r.avgCost) }));
}

export async function pickCustomers(db: DbOrTx, orgId: string) {
  return db.select({ id: customers.id, name: customers.name, code: customers.code }).from(customers).where(and(eq(customers.orgId, orgId), eq(customers.active, true))).orderBy(asc(customers.name));
}

export async function pickVendors(db: DbOrTx, orgId: string) {
  return db.select({ id: vendors.id, name: vendors.name, code: vendors.code, leadTimeDays: vendors.leadTimeDays }).from(vendors).where(and(eq(vendors.orgId, orgId), eq(vendors.active, true))).orderBy(asc(vendors.name));
}

export async function pickLocations(db: DbOrTx, orgId: string) {
  return db.select({ id: locations.id, code: locations.code, name: locations.name, type: locations.type }).from(locations).where(and(eq(locations.orgId, orgId), eq(locations.active, true))).orderBy(asc(locations.code));
}

export async function pickEmployees(db: DbOrTx, orgId: string) {
  return db.select({ id: employees.id, name: employees.name, badge: employees.badge }).from(employees).where(and(eq(employees.orgId, orgId), eq(employees.active, true))).orderBy(asc(employees.name));
}
