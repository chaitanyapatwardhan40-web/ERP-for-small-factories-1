"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { campaigns, customers, leads, LEAD_STAGES } from "@/lib/db/schema";
import { requireOrg, assertCan } from "@/lib/tenancy";
import { nextNumber } from "@/lib/numbering";
import { formObject, optNum, optStr, reqStr, withFormErrors } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";

export async function saveLeadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "crm.edit");
    const input = z
      .object({ id: optStr, company: reqStr, contactName: optStr, email: optStr, phone: optStr, source: optStr, stage: z.enum(LEAD_STAGES).optional(), estimatedValue: optNum, nextAction: optStr, nextActionAt: optStr, expectedClose: optStr, notes: optStr })
      .parse(formObject(formData));
    const db = await getDb();
    const values = {
      company: input.company,
      contactName: input.contactName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      source: input.source ?? null,
      stage: input.stage ?? "new",
      estimatedValue: input.estimatedValue ?? 0,
      nextAction: input.nextAction ?? null,
      nextActionAt: input.nextActionAt ? new Date(input.nextActionAt) : null,
      expectedClose: input.expectedClose || null,
      notes: input.notes ?? null,
      ownerId: ctx.userId,
      updatedAt: new Date(),
    };
    if (input.id) {
      await db.update(leads).set(values).where(and(eq(leads.id, input.id), eq(leads.orgId, ctx.orgId)));
      revalidatePath(`/crm/${input.id}`);
      revalidatePath("/crm");
      return { ok: "Saved." };
    }
    const [row] = await db.insert(leads).values({ orgId: ctx.orgId, ...values }).returning();
    redirect(`/crm/${row.id}`);
  });
}

export async function leadStageAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "crm.edit");
  const id = String(formData.get("id") ?? "");
  const stage = String(formData.get("stage") ?? "new") as (typeof LEAD_STAGES)[number];
  const lostReason = String(formData.get("lostReason") ?? "") || null;
  const db = await getDb();
  await db.update(leads).set({ stage, lostReason: stage === "lost" ? lostReason : null, updatedAt: new Date() }).where(and(eq(leads.id, id), eq(leads.orgId, ctx.orgId)));
  revalidatePath("/crm");
  revalidatePath(`/crm/${id}`);
}

/** Won: the lead becomes a customer and the quote can start. */
export async function convertLeadAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "crm.edit");
  const id = String(formData.get("id") ?? "");
  const db = await getDb();
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.orgId, ctx.orgId)));
  if (!lead) redirect("/crm");
  let customerId = lead.customerId;
  if (!customerId) {
    const code = await nextNumber(db, ctx.orgId, "customer");
    const [c] = await db.insert(customers).values({ orgId: ctx.orgId, code, name: lead.company, email: lead.email, phone: lead.phone }).returning();
    customerId = c.id;
    await db.update(leads).set({ customerId, stage: "won", updatedAt: new Date() }).where(eq(leads.id, id));
  }
  redirect(`/quotes/new?customerId=${customerId}`);
}

export async function saveCampaignAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "crm.edit");
    const input = z.object({ name: reqStr, type: z.enum(["reactivation", "newsletter", "announcement"]).default("reactivation"), subject: reqStr, body: reqStr, send: optStr }).parse(formObject(formData));
    const audience = formData.getAll("customerId").map(String);
    const db = await getDb();
    await db.insert(campaigns).values({
      orgId: ctx.orgId,
      name: input.name,
      type: input.type,
      subject: input.subject,
      body: input.body,
      audience,
      status: input.send ? "sent" : "draft",
      sentAt: input.send ? new Date() : null,
    });
    revalidatePath("/crm");
    return { ok: input.send ? `Campaign saved as sent to ${audience.length} customers. Email delivery connects via RESEND_API_KEY.` : "Draft saved." };
  });
}
