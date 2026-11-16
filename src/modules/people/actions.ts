"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { employees } from "@/lib/db/schema";
import { requireOrg, assertCan } from "@/lib/tenancy";
import { bool, formObject, optNum, optStr, reqStr, withFormErrors } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";

export async function saveEmployeeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "settings.edit");
    const input = z.object({ id: optStr, name: reqStr, badge: optStr, hourlyRate: optNum, skills: optStr, active: bool.optional() }).parse(formObject(formData));
    const db = await getDb();
    const values = {
      name: input.name,
      badge: input.badge ?? null,
      hourlyRate: input.hourlyRate ?? 0,
      skills: (input.skills ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      active: input.active ?? true,
      updatedAt: new Date(),
    };
    if (input.id) await db.update(employees).set(values).where(and(eq(employees.id, input.id), eq(employees.orgId, ctx.orgId)));
    else await db.insert(employees).values({ orgId: ctx.orgId, ...values });
    revalidatePath("/people");
    return { ok: "Saved." };
  });
}
