"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { orgs } from "@/lib/db/schema";
import { requireOrg, assertCan } from "@/lib/tenancy";
import { formObject, optDate, optNum, optStr, reqStr, withFormErrors } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";
import {
  cancelWorkOrder,
  clockIn,
  clockOut,
  completeWorkOrder,
  createWorkOrder,
  createWorkOrdersForOrder,
  issueAllMaterials,
  issueMaterial,
  recordLabor,
  releaseWorkOrder,
} from "./service";

export async function createWorkOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "production.edit");
    const input = z
      .object({ itemId: reqStr, qty: z.coerce.number().positive(), dueDate: optDate, priority: optNum, notes: optStr, release: optStr })
      .parse(formObject(formData));
    const db = await getDb();
    const wo = await db.transaction(async (tx) => {
      const w = await createWorkOrder(tx, ctx, { itemId: input.itemId, qty: input.qty, dueDate: input.dueDate ?? null, priority: input.priority, notes: input.notes });
      if (input.release) await releaseWorkOrder(tx, ctx, w.id);
      return w;
    });
    redirect(`/work-orders/${wo.id}`);
  });
}

export async function createWorkOrdersForOrderAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "production.edit");
  const orderId = String(formData.get("orderId") ?? "");
  const db = await getDb();
  const created = await db.transaction((tx) => createWorkOrdersForOrder(tx, ctx, orderId));
  revalidatePath(`/orders/${orderId}`);
  if (created.length === 1) redirect(`/work-orders/${created[0].id}`);
  redirect(`/orders/${orderId}`);
}

export async function releaseWorkOrderAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "production.edit");
  const id = String(formData.get("id") ?? "");
  const db = await getDb();
  await releaseWorkOrder(db, ctx, id);
  revalidatePath(`/work-orders/${id}`);
}

export async function cancelWorkOrderAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "production.edit");
  const id = String(formData.get("id") ?? "");
  const db = await getDb();
  await cancelWorkOrder(db, ctx, id);
  revalidatePath(`/work-orders/${id}`);
}

export async function issueMaterialAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "inventory.edit");
    const input = z.object({ workOrderId: reqStr, itemId: reqStr, qty: z.coerce.number().positive(), locationId: reqStr, lotNumber: optStr }).parse(formObject(formData));
    const db = await getDb();
    await db.transaction((tx) => issueMaterial(tx, ctx, { ...input, lotNumber: input.lotNumber ?? null }));
    revalidatePath(`/work-orders/${input.workOrderId}`);
    return { ok: "Issued." };
  });
}

export async function issueAllAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "inventory.edit");
    const input = z.object({ workOrderId: reqStr, locationId: reqStr }).parse(formObject(formData));
    const db = await getDb();
    const short = await db.transaction((tx) => issueAllMaterials(tx, ctx, input.workOrderId, input.locationId));
    revalidatePath(`/work-orders/${input.workOrderId}`);
    if (short.length) return { error: `Issued what was available. Short: ${short.map((s) => `${s.sku} (need ${s.needed}, have ${s.available})`).join("; ")}` };
    return { ok: "All materials issued." };
  });
}

export async function clockInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "shopfloor.clock");
    const input = z.object({ operationId: reqStr, employeeId: reqStr, returnTo: optStr }).parse(formObject(formData));
    const db = await getDb();
    await db.transaction((tx) => clockIn(tx, ctx, input));
    revalidatePath(input.returnTo ?? "/shop-floor");
    return { ok: "Clocked in." };
  });
}

export async function clockOutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "shopfloor.clock");
    const input = z.object({ laborEntryId: reqStr, qtyGood: optNum, qtyScrap: optNum, notes: optStr, operationComplete: optStr, returnTo: optStr }).parse(formObject(formData));
    const db = await getDb();
    const r = await db.transaction((tx) => clockOut(tx, ctx, { ...input, operationComplete: !!input.operationComplete }));
    revalidatePath(input.returnTo ?? "/shop-floor");
    return { ok: `Clocked out: ${r.hours.toFixed(2)} h.` };
  });
}

export async function recordLaborAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "production.edit");
    const input = z
      .object({ operationId: reqStr, employeeId: reqStr, hours: z.coerce.number().positive(), qtyGood: optNum, qtyScrap: optNum, notes: optStr, operationComplete: optStr, workOrderId: reqStr })
      .parse(formObject(formData));
    const db = await getDb();
    await db.transaction((tx) => recordLabor(tx, ctx, { ...input, operationComplete: !!input.operationComplete }));
    revalidatePath(`/work-orders/${input.workOrderId}`);
    return { ok: "Labour recorded." };
  });
}

export async function completeWorkOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "production.edit");
    const input = z.object({ workOrderId: reqStr, qtyGood: z.coerce.number().min(0), qtyScrap: optNum, locationId: reqStr, lotNumber: optStr }).parse(formObject(formData));
    const db = await getDb();
    const [org] = await db.select().from(orgs).where(eq(orgs.id, ctx.orgId));
    await db.transaction((tx) =>
      completeWorkOrder(tx, ctx, { ...input, lotNumber: input.lotNumber ?? null, overheadPct: org?.settings.overheadPct ?? 0 }),
    );
    revalidatePath(`/work-orders/${input.workOrderId}`);
    // The completion card unmounts on success; the Result card on the fresh page shows the outcome.
    redirect(`/work-orders/${input.workOrderId}`);
  });
}
