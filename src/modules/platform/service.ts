import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { locations, memberships, orgs, units, users, workCenters } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { seedBooks } from "@/modules/books/service";

export class PlatformError extends Error {}

export function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40) || "shop";
}

export async function registerUser(db: DbOrTx, input: { email: string; name: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) throw new PlatformError("An account with that email already exists. Sign in instead.");
  if (input.password.length < 8) throw new PlatformError("Password must be at least 8 characters");
  const [user] = await db
    .insert(users)
    .values({ email, name: input.name.trim(), passwordHash: await hashPassword(input.password) })
    .returning();
  return user;
}

/** Create a factory with the defaults a shop needs on day one. */
export async function createOrg(db: DbOrTx, input: { name: string; ownerUserId: string; overheadPct?: number; taxRatePct?: number }) {
  let slug = slugify(input.name);
  const [taken] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, slug));
  if (taken) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const [org] = await db
    .insert(orgs)
    .values({
      name: input.name.trim(),
      slug,
      settings: {
        currency: "USD",
        fiscalYearStartMonth: 1,
        defaultTermsDays: 30,
        defaultTaxRatePct: input.taxRatePct ?? 0,
        overheadPct: input.overheadPct ?? 25,
        defaultMarginPct: 30,
      },
    })
    .returning();
  await db.insert(memberships).values({ orgId: org.id, userId: input.ownerUserId, role: "owner" });
  await seedBooks(db, org.id);
  await db.insert(locations).values([
    { orgId: org.id, code: "MAIN", name: "Main stock", type: "stock" },
    { orgId: org.id, code: "WIP", name: "Shop floor", type: "wip" },
    { orgId: org.id, code: "SHIP", name: "Shipping dock", type: "shipping" },
    { orgId: org.id, code: "QUAR", name: "Quarantine", type: "quarantine" },
  ]);
  await db.insert(units).values(
    [
      ["ea", "Each"],
      ["ft", "Feet"],
      ["in", "Inches"],
      ["lb", "Pounds"],
      ["kg", "Kilograms"],
      ["hr", "Hours"],
      ["sqft", "Square feet"],
    ].map(([code, name]) => ({ orgId: org.id, code, name })),
  );
  await db.insert(workCenters).values({ orgId: org.id, code: "ASM", name: "Assembly", hourlyRate: 45, capacityHoursPerDay: 8 });
  return org;
}

export async function addMember(db: DbOrTx, orgId: string, email: string, role: "owner" | "office" | "shop" | "accountant" | "readonly") {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  if (!user) throw new PlatformError("No account with that email yet. Ask them to register first, then add them.");
  const [existing] = await db.select().from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, user.id)));
  if (existing) {
    await db.update(memberships).set({ role }).where(eq(memberships.id, existing.id));
    return existing;
  }
  const [m] = await db.insert(memberships).values({ orgId, userId: user.id, role }).returning();
  return m;
}

export async function orgsForUser(db: DbOrTx, userId: string) {
  return db
    .select({ id: orgs.id, name: orgs.name, slug: orgs.slug, role: memberships.role })
    .from(memberships)
    .innerJoin(orgs, eq(orgs.id, memberships.orgId))
    .where(eq(memberships.userId, userId));
}
