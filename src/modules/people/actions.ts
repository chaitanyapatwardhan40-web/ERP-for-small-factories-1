"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { employees, employeeTrainings } from "@/lib/db/schema";
import { requireOrg, assertCan } from "@/lib/tenancy";
import { bool, dateStr, formObject, optDate, optNum, optStr, reqStr, withFormErrors } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";

export async function saveEmployeeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "settings.edit");
    const input = z
      .object({ id: optStr, name: reqStr, badge: optStr, hourlyRate: optNum, skills: optStr, department: optStr, shift: optStr, hireDate: optDate, email: optStr, phone: optStr, active: bool.optional() })
      .parse(formObject(formData));
    const db = await getDb();
    const values = {
      name: input.name,
      badge: input.badge ?? null,
      hourlyRate: input.hourlyRate ?? 0,
      skills: (input.skills ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      department: input.department ?? null,
      shift: input.shift ?? null,
      hireDate: input.hireDate ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      active: input.active ?? true,
      updatedAt: new Date(),
    };
    if (input.id) await db.update(employees).set(values).where(and(eq(employees.id, input.id), eq(employees.orgId, ctx.orgId)));
    else await db.insert(employees).values({ orgId: ctx.orgId, ...values });
    revalidatePath("/people");
    return { ok: "Saved." };
  });
}

export async function addTrainingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "settings.edit");
    const input = z.object({ employeeId: reqStr, skill: reqStr, trainedAt: dateStr, expiresAt: optDate, trainer: optStr, notes: optStr }).parse(formObject(formData));
    const db = await getDb();
    const [e] = await db.select().from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.orgId, ctx.orgId)));
    if (!e) throw new Error("Employee not found");
    await db.insert(employeeTrainings).values({ orgId: ctx.orgId, employeeId: e.id, skill: input.skill, trainedAt: input.trainedAt, expiresAt: input.expiresAt ?? null, trainer: input.trainer ?? null, notes: input.notes ?? null });
    if (!e.skills.includes(input.skill)) await db.update(employees).set({ skills: [...e.skills, input.skill], updatedAt: new Date() }).where(eq(employees.id, e.id));
    revalidatePath("/people");
    return { ok: "Training recorded." };
  });
}

export async function deleteTrainingAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "settings.edit");
  const db = await getDb();
  await db.delete(employeeTrainings).where(and(eq(employeeTrainings.id, String(formData.get("id") ?? "")), eq(employeeTrainings.orgId, ctx.orgId)));
  revalidatePath("/people");
}
