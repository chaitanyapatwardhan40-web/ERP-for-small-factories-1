"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { bomLines, bomRevisions, items, locations, orgs, routingOperations, routings, workCenters, ITEM_TYPES } from "@/lib/db/schema";
import { requireOrg, assertCan } from "@/lib/tenancy";
import { audit } from "@/lib/audit";
import { bool, formObject, optNum, optStr, reqStr, withFormErrors } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";
import { refreshStandardCost } from "./service";

const itemSchema = z.object({
  id: optStr,
  sku: reqStr,
  name: reqStr,
  description: optStr,
  type: z.enum(ITEM_TYPES),
  uom: z.string().trim().min(1).default("ea"),
  standardCost: optNum,
  salesPrice: optNum,
  reorderPoint: optNum,
  reorderQty: optNum,
  leadTimeDays: optNum,
  preferredVendorId: optStr,
  trackLots: bool.optional(),
  revision: optStr,
  drawingNumber: optStr,
  category: optStr,
  barcode: optStr,
  weight: optNum,
  safetyStock: optNum,
  minOrderQty: optNum,
  shelfLifeDays: optNum,
  status: z.enum(["active", "obsolete"]).optional(),
});

export async function saveItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "master.edit");
    const input = itemSchema.parse(formObject(formData));
    const db = await getDb();
    const values = {
      sku: input.sku,
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      uom: input.uom,
      standardCost: input.standardCost ?? 0,
      salesPrice: input.salesPrice ?? 0,
      reorderPoint: input.reorderPoint ?? 0,
      reorderQty: input.reorderQty ?? 0,
      leadTimeDays: input.leadTimeDays ?? 0,
      preferredVendorId: input.preferredVendorId || null,
      trackLots: input.trackLots ?? false,
      revision: input.revision || "A",
      drawingNumber: input.drawingNumber ?? null,
      category: input.category ?? null,
      barcode: input.barcode ?? null,
      weight: input.weight ?? 0,
      safetyStock: input.safetyStock ?? 0,
      minOrderQty: input.minOrderQty ?? 0,
      shelfLifeDays: input.shelfLifeDays ?? null,
      status: input.status ?? "active",
      updatedAt: new Date(),
    };
    if (input.id) {
      await db.update(items).set(values).where(and(eq(items.id, input.id), eq(items.orgId, ctx.orgId)));
      await audit(db, { orgId: ctx.orgId, userId: ctx.userId, action: "item.update", entityType: "item", entityId: input.id });
      revalidatePath(`/items/${input.id}`);
      redirect(`/items/${input.id}`);
    }
    const [row] = await db.insert(items).values({ orgId: ctx.orgId, ...values }).returning();
    await audit(db, { orgId: ctx.orgId, userId: ctx.userId, action: "item.create", entityType: "item", entityId: row.id });
    redirect(`/items/${row.id}`);
  });
}

async function ensureBomRevision(orgId: string, itemId: string) {
  const db = await getDb();
  const [rev] = await db
    .select()
    .from(bomRevisions)
    .where(and(eq(bomRevisions.orgId, orgId), eq(bomRevisions.itemId, itemId), eq(bomRevisions.status, "active")));
  if (rev) return rev;
  const [draft] = await db
    .select()
    .from(bomRevisions)
    .where(and(eq(bomRevisions.orgId, orgId), eq(bomRevisions.itemId, itemId)));
  if (draft) return draft;
  const [created] = await db.insert(bomRevisions).values({ orgId, itemId, rev: "A", status: "active" }).returning();
  return created;
}

export async function addBomLineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "master.edit");
    const input = z
      .object({ itemId: reqStr, componentSku: reqStr, qty: z.coerce.number().positive(), scrapPct: optNum, refDes: optStr, notes: optStr })
      .parse(formObject(formData));
    const db = await getDb();
    const [comp] = await db.select().from(items).where(and(eq(items.orgId, ctx.orgId), eq(items.sku, input.componentSku.trim())));
    if (!comp) return { error: `No item with SKU "${input.componentSku}". Create it first.` };
    if (comp.id === input.itemId) return { error: "An item cannot contain itself." };
    const rev = await ensureBomRevision(ctx.orgId, input.itemId);
    const existing = await db.select().from(bomLines).where(eq(bomLines.bomRevisionId, rev.id));
    await db.insert(bomLines).values({
      orgId: ctx.orgId,
      bomRevisionId: rev.id,
      componentItemId: comp.id,
      qty: input.qty,
      scrapPct: input.scrapPct ?? 0,
      position: (existing.length + 1) * 10,
      refDes: input.refDes ?? null,
      notes: input.notes ?? null,
    });
    await recost(ctx.orgId, input.itemId);
    revalidatePath(`/items/${input.itemId}`);
    return { ok: `${comp.sku} added.` };
  });
}

export async function removeBomLineAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "master.edit");
  const id = String(formData.get("id") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const db = await getDb();
  await db.delete(bomLines).where(and(eq(bomLines.id, id), eq(bomLines.orgId, ctx.orgId)));
  await recost(ctx.orgId, itemId);
  revalidatePath(`/items/${itemId}`);
}

export async function newBomRevisionAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "master.edit");
  const itemId = String(formData.get("itemId") ?? "");
  const db = await getDb();
  const current = await ensureBomRevision(ctx.orgId, itemId);
  const lines = await db.select().from(bomLines).where(eq(bomLines.bomRevisionId, current.id));
  const nextRev = String.fromCharCode((current.rev.charCodeAt(0) || 64) + 1);
  const [rev] = await db.insert(bomRevisions).values({ orgId: ctx.orgId, itemId, rev: nextRev, status: "active" }).returning();
  await db.update(bomRevisions).set({ status: "obsolete" }).where(eq(bomRevisions.id, current.id));
  if (lines.length) {
    await db.insert(bomLines).values(lines.map((l) => ({ orgId: ctx.orgId, bomRevisionId: rev.id, componentItemId: l.componentItemId, qty: l.qty, scrapPct: l.scrapPct, position: l.position, notes: l.notes })));
  }
  await db.update(items).set({ revision: nextRev, updatedAt: new Date() }).where(eq(items.id, itemId));
  revalidatePath(`/items/${itemId}`);
}

async function ensureRouting(orgId: string, itemId: string) {
  const db = await getDb();
  const [r] = await db.select().from(routings).where(and(eq(routings.orgId, orgId), eq(routings.itemId, itemId), eq(routings.status, "active")));
  if (r) return r;
  const [created] = await db.insert(routings).values({ orgId, itemId, rev: "A", status: "active" }).returning();
  return created;
}

export async function addOperationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "master.edit");
    const input = z
      .object({
        itemId: reqStr,
        name: reqStr,
        workCenterId: optStr,
        setupHours: optNum,
        runMinutesPerUnit: optNum,
        outsideVendorId: optStr,
        outsideCostPerUnit: optNum,
        instructions: optStr,
      })
      .parse(formObject(formData));
    const db = await getDb();
    const routing = await ensureRouting(ctx.orgId, input.itemId);
    const ops = await db.select().from(routingOperations).where(eq(routingOperations.routingId, routing.id));
    await db.insert(routingOperations).values({
      orgId: ctx.orgId,
      routingId: routing.id,
      seq: (ops.length + 1) * 10,
      name: input.name,
      workCenterId: input.workCenterId || null,
      setupHours: input.setupHours ?? 0,
      runHoursPerUnit: (input.runMinutesPerUnit ?? 0) / 60,
      outsideVendorId: input.outsideVendorId || null,
      outsideCostPerUnit: input.outsideCostPerUnit ?? 0,
      instructions: input.instructions ?? null,
    });
    await recost(ctx.orgId, input.itemId);
    revalidatePath(`/items/${input.itemId}`);
    return { ok: "Operation added." };
  });
}

export async function removeOperationAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "master.edit");
  const id = String(formData.get("id") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const db = await getDb();
  await db.delete(routingOperations).where(and(eq(routingOperations.id, id), eq(routingOperations.orgId, ctx.orgId)));
  await recost(ctx.orgId, itemId);
  revalidatePath(`/items/${itemId}`);
}

export async function recostItemAction(formData: FormData) {
  const ctx = await requireOrg();
  const itemId = String(formData.get("itemId") ?? "");
  await recost(ctx.orgId, itemId);
  revalidatePath(`/items/${itemId}`);
}

async function recost(orgId: string, itemId: string) {
  const db = await getDb();
  const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
  try {
    await refreshStandardCost(db, orgId, itemId, { overheadPct: org?.settings.overheadPct ?? 0 });
  } catch {
    // A loop or missing item: leave the stored cost as is.
  }
}

export async function saveWorkCenterAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "master.edit");
    const input = z
      .object({ id: optStr, code: reqStr, name: reqStr, hourlyRate: optNum, capacityHoursPerDay: optNum, active: bool.optional() })
      .parse(formObject(formData));
    const db = await getDb();
    const values = { code: input.code, name: input.name, hourlyRate: input.hourlyRate ?? 0, capacityHoursPerDay: input.capacityHoursPerDay ?? 8, active: input.active ?? true, updatedAt: new Date() };
    if (input.id) await db.update(workCenters).set(values).where(and(eq(workCenters.id, input.id), eq(workCenters.orgId, ctx.orgId)));
    else await db.insert(workCenters).values({ orgId: ctx.orgId, ...values });
    revalidatePath("/items/work-centers");
    return { ok: "Saved." };
  });
}

export async function saveLocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "master.edit");
    const input = z
      .object({ id: optStr, code: reqStr, name: reqStr, type: z.enum(["stock", "wip", "staging", "shipping", "quarantine"]).default("stock"), active: bool.optional() })
      .parse(formObject(formData));
    const db = await getDb();
    const values = { code: input.code, name: input.name, type: input.type, active: input.active ?? true, updatedAt: new Date() };
    if (input.id) await db.update(locations).set(values).where(and(eq(locations.id, input.id), eq(locations.orgId, ctx.orgId)));
    else await db.insert(locations).values({ orgId: ctx.orgId, ...values });
    revalidatePath("/items/locations");
    return { ok: "Saved." };
  });
}
