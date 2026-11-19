"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { capas, gauges, inspectionPlans, inspections, ncrs, vendors, type Measurement } from "@/lib/db/schema";
import { requireOrg, assertCan } from "@/lib/tenancy";
import { audit } from "@/lib/audit";
import { nextNumber } from "@/lib/numbering";
import { formLines, formObject, optDate, optNum, optStr, reqStr, withFormErrors } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";
import { addDays } from "@/lib/money";

export async function savePlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "quality.edit");
    const head = z.object({ name: reqStr, stage: z.enum(["incoming", "in_process", "final"]), itemId: optStr, sampleSize: optNum }).parse(formObject(formData));
    const checks = z
      .array(z.object({ name: reqStr, type: z.enum(["measurement", "visual", "document"]).default("visual"), unit: optStr, min: optNum, max: optNum }))
      .parse(formLines(formData, "checks"));
    const db = await getDb();
    await db.insert(inspectionPlans).values({ orgId: ctx.orgId, name: head.name, stage: head.stage, itemId: head.itemId || null, sampleSize: head.sampleSize ?? 1, checklist: checks });
    revalidatePath("/quality");
    return { ok: "Plan saved." };
  });
}

export async function recordInspectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "quality.edit");
    const head = z
      .object({ planId: optStr, stage: z.enum(["incoming", "in_process", "final"]), refType: optStr, refId: optStr, itemId: optStr, qtyInspected: optNum, qtyRejected: optNum, notes: optStr, openNcr: optStr, returnTo: optStr })
      .parse(formObject(formData));
    const results = z.array(z.object({ name: reqStr, value: optStr, pass: optStr })).parse(formLines(formData, "results"));
    const measurements: Measurement[] = results.map((r) => ({ name: r.name, value: r.value === undefined ? undefined : isNaN(Number(r.value)) ? r.value : Number(r.value), pass: r.pass === "on" || r.pass === "true" }));
    const result = measurements.every((m) => m.pass) && !(head.qtyRejected && head.qtyRejected > 0) ? "pass" : "fail";
    const db = await getDb();
    const [row] = await db
      .insert(inspections)
      .values({
        orgId: ctx.orgId,
        planId: head.planId || null,
        stage: head.stage,
        refType: head.refType ?? null,
        refId: head.refId || null,
        itemId: head.itemId || null,
        qtyInspected: head.qtyInspected ?? 1,
        qtyRejected: head.qtyRejected ?? 0,
        result,
        measurements,
        inspectedBy: ctx.userId,
        notes: head.notes ?? null,
      })
      .returning();
    if (result === "fail" && head.openNcr) {
      const number = await nextNumber(db, ctx.orgId, "ncr");
      await db.insert(ncrs).values({
        orgId: ctx.orgId,
        number,
        source: head.stage === "incoming" ? "incoming" : head.stage === "final" ? "final" : "in_process",
        itemId: head.itemId || null,
        qty: head.qtyRejected ?? 1,
        description: `Failed ${head.stage} inspection: ${measurements.filter((m) => !m.pass).map((m) => m.name).join(", ") || "rejected"}${head.notes ? ` — ${head.notes}` : ""}`,
        openedBy: ctx.userId,
      });
    }
    await audit(db, { orgId: ctx.orgId, userId: ctx.userId, action: "inspection.record", entityType: "inspection", entityId: row.id, data: { result } });
    revalidatePath(head.returnTo ?? "/quality");
    revalidatePath("/quality/ncrs");
    return { ok: result === "pass" ? "Passed." : `Failed${head.openNcr ? "; NCR opened" : ""}.` };
  });
}

export async function openNcrAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "quality.edit");
    const input = z
      .object({ source: z.enum(["incoming", "in_process", "final", "customer"]), itemId: optStr, vendorId: optStr, workOrderId: optStr, qty: optNum, description: reqStr })
      .parse(formObject(formData));
    const db = await getDb();
    const number = await nextNumber(db, ctx.orgId, "ncr");
    await db.insert(ncrs).values({ orgId: ctx.orgId, number, source: input.source, itemId: input.itemId || null, vendorId: input.vendorId || null, workOrderId: input.workOrderId || null, qty: input.qty ?? 1, description: input.description, openedBy: ctx.userId });
    revalidatePath("/quality/ncrs");
    return { ok: `${number} opened.` };
  });
}

export async function dispositionNcrAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "quality.edit");
    const input = z.object({ id: reqStr, disposition: z.enum(["pending", "use_as_is", "rework", "scrap", "return_to_vendor"]), rootCause: optStr, containment: optStr, cost: optNum, customerRef: optStr, close: optStr }).parse(formObject(formData));
    const db = await getDb();
    await db
      .update(ncrs)
      .set({ disposition: input.disposition, rootCause: input.rootCause ?? null, containment: input.containment ?? null, cost: input.cost ?? 0, customerRef: input.customerRef ?? null, status: input.close ? "closed" : "open", closedAt: input.close ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(ncrs.id, input.id), eq(ncrs.orgId, ctx.orgId)));
    // Vendor rating: 100 minus 5 per open NCR this year (simple, explainable).
    const [ncr] = await db.select().from(ncrs).where(eq(ncrs.id, input.id));
    if (ncr?.vendorId) {
      const [cnt] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(ncrs).where(and(eq(ncrs.vendorId, ncr.vendorId), eq(ncrs.status, "open")));
      await db.update(vendors).set({ rating: Math.max(0, 100 - 5 * (cnt?.n ?? 0)) }).where(eq(vendors.id, ncr.vendorId));
    }
    revalidatePath("/quality/ncrs");
    return { ok: "Saved." };
  });
}

export async function addCapaAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "quality.edit");
    const input = z.object({ ncrId: optStr, rootCause: optStr, correctiveAction: reqStr, preventiveAction: optStr, owner: optStr, dueDate: optDate, effectivenessCheckAt: optDate }).parse(formObject(formData));
    const db = await getDb();
    const number = await nextNumber(db, ctx.orgId, "capa");
    await db.insert(capas).values({ orgId: ctx.orgId, number, ncrId: input.ncrId || null, rootCause: input.rootCause ?? null, correctiveAction: input.correctiveAction, preventiveAction: input.preventiveAction ?? null, owner: input.owner ?? null, dueDate: input.dueDate ?? null, effectivenessCheckAt: input.effectivenessCheckAt ?? null });
    revalidatePath("/quality/ncrs");
    return { ok: `${number} opened.` };
  });
}

export async function capaStatusAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "quality.edit");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "open") as "open" | "verified" | "closed";
  const effectiveRaw = String(formData.get("effective") ?? "");
  const db = await getDb();
  await db
    .update(capas)
    .set({ status, effective: effectiveRaw === "" ? undefined : effectiveRaw === "yes", updatedAt: new Date() })
    .where(and(eq(capas.id, id), eq(capas.orgId, ctx.orgId)));
  revalidatePath("/quality/ncrs");
}

export async function saveGaugeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "quality.edit");
    const input = z.object({ id: optStr, name: reqStr, serial: optStr, location: optStr, owner: optStr, calibrationIntervalDays: optNum, lastCalibratedAt: optDate }).parse(formObject(formData));
    const db = await getDb();
    const interval = input.calibrationIntervalDays ?? 365;
    const next = input.lastCalibratedAt ? addDays(input.lastCalibratedAt, interval) : null;
    const values = { name: input.name, serial: input.serial ?? null, location: input.location ?? null, owner: input.owner ?? null, calibrationIntervalDays: interval, lastCalibratedAt: input.lastCalibratedAt ?? null, nextDueAt: next, status: "in_service" as const, updatedAt: new Date() };
    if (input.id) await db.update(gauges).set(values).where(and(eq(gauges.id, input.id), eq(gauges.orgId, ctx.orgId)));
    else await db.insert(gauges).values({ orgId: ctx.orgId, ...values });
    revalidatePath("/quality/gauges");
    return { ok: "Saved." };
  });
}

export async function calibrateGaugeAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "quality.edit");
  const id = String(formData.get("id") ?? "");
  const date = String(formData.get("date") ?? "");
  const result = (String(formData.get("result") ?? "pass") || "pass") as "pass" | "fail" | "adjusted";
  const certNo = String(formData.get("certNo") ?? "") || null;
  const performedBy = String(formData.get("performedBy") ?? "") || null;
  const notes = String(formData.get("notes") ?? "") || null;
  const db = await getDb();
  const [g] = await db.select().from(gauges).where(and(eq(gauges.id, id), eq(gauges.orgId, ctx.orgId)));
  if (g && date) {
    const { gaugeCalibrations } = await import("@/lib/db/schema");
    const dueAt = addDays(date, g.calibrationIntervalDays);
    await db.insert(gaugeCalibrations).values({ orgId: ctx.orgId, gaugeId: g.id, calibratedAt: date, dueAt, result, certNo, performedBy, notes });
    await db
      .update(gauges)
      .set({ lastCalibratedAt: date, nextDueAt: dueAt, status: result === "fail" ? "out_of_service" : "in_service", updatedAt: new Date() })
      .where(eq(gauges.id, id));
    await audit(db, { orgId: ctx.orgId, userId: ctx.userId, action: "gauge.calibrate", entityType: "gauge", entityId: g.id, data: { date, result, certNo } });
  }
  revalidatePath("/quality/gauges");
}
