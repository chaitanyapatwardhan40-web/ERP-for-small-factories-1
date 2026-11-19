"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { assets, downtimeLogs, maintenanceTasks } from "@/lib/db/schema";
import { requireOrg, assertCan } from "@/lib/tenancy";
import { formObject, optDate, optNum, optStr, reqStr, withFormErrors } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";
import { addDays, today } from "@/lib/money";

export async function saveAssetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "maintenance.edit");
    const input = z.object({ name: reqStr, workCenterId: optStr, serial: optStr, purchasedAt: optDate, manufacturer: optStr, model: optStr, location: optStr }).parse(formObject(formData));
    const db = await getDb();
    await db.insert(assets).values({ orgId: ctx.orgId, name: input.name, workCenterId: input.workCenterId || null, serial: input.serial ?? null, purchasedAt: input.purchasedAt ?? null, manufacturer: input.manufacturer ?? null, model: input.model ?? null, location: input.location ?? null });
    revalidatePath("/maintenance");
    return { ok: "Machine added." };
  });
}

export async function saveTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "maintenance.edit");
    const input = z.object({ assetId: reqStr, name: reqStr, intervalDays: optNum, lastDoneAt: optDate, instructions: optStr }).parse(formObject(formData));
    const db = await getDb();
    const interval = input.intervalDays ?? 90;
    const last = input.lastDoneAt ?? today();
    await db.insert(maintenanceTasks).values({ orgId: ctx.orgId, assetId: input.assetId, name: input.name, intervalDays: interval, lastDoneAt: last, nextDueAt: addDays(last, interval), instructions: input.instructions ?? null });
    revalidatePath("/maintenance");
    return { ok: "Task scheduled." };
  });
}

export async function completeTaskAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "maintenance.edit");
  const id = String(formData.get("id") ?? "");
  const db = await getDb();
  const [t] = await db.select().from(maintenanceTasks).where(and(eq(maintenanceTasks.id, id), eq(maintenanceTasks.orgId, ctx.orgId)));
  if (t) {
    const done = today();
    await db.update(maintenanceTasks).set({ lastDoneAt: done, nextDueAt: addDays(done, t.intervalDays), updatedAt: new Date() }).where(eq(maintenanceTasks.id, id));
  }
  revalidatePath("/maintenance");
}

export async function downtimeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "maintenance.edit");
    const input = z.object({ assetId: reqStr, reason: reqStr, notes: optStr }).parse(formObject(formData));
    const db = await getDb();
    await db.insert(downtimeLogs).values({ orgId: ctx.orgId, assetId: input.assetId, reason: input.reason, notes: input.notes ?? null });
    await db.update(assets).set({ status: "down", updatedAt: new Date() }).where(and(eq(assets.id, input.assetId), eq(assets.orgId, ctx.orgId)));
    revalidatePath("/maintenance");
    return { ok: "Logged as down." };
  });
}

export async function backUpAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "maintenance.edit");
  const id = String(formData.get("assetId") ?? "");
  const db = await getDb();
  const open = await db.select().from(downtimeLogs).where(and(eq(downtimeLogs.assetId, id), eq(downtimeLogs.orgId, ctx.orgId)));
  for (const d of open.filter((x) => !x.endedAt)) {
    await db.update(downtimeLogs).set({ endedAt: new Date() }).where(eq(downtimeLogs.id, d.id));
  }
  await db.update(assets).set({ status: "running", updatedAt: new Date() }).where(and(eq(assets.id, id), eq(assets.orgId, ctx.orgId)));
  revalidatePath("/maintenance");
}
