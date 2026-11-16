"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { activities, contacts, customers, vendors } from "@/lib/db/schema";
import { requireOrg, assertCan } from "@/lib/tenancy";
import { audit } from "@/lib/audit";
import { nextNumber } from "@/lib/numbering";
import { bool, formObject, optNum, optStr, reqStr, withFormErrors } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";

function pickAddress(o: Record<string, unknown>, p: string) {
  const a = {
    line1: o[`${p}Line1`] as string | undefined,
    city: o[`${p}City`] as string | undefined,
    state: o[`${p}State`] as string | undefined,
    postalCode: o[`${p}PostalCode`] as string | undefined,
    country: o[`${p}Country`] as string | undefined,
  };
  return Object.values(a).some(Boolean) ? a : null;
}

const customerSchema = z.object({
  id: optStr,
  code: optStr,
  name: reqStr,
  email: optStr,
  phone: optStr,
  termsDays: optNum,
  taxExempt: bool.optional(),
  notes: optStr,
  active: bool.optional(),
});

export async function saveCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "master.edit");
    const raw = formObject(formData);
    const input = customerSchema.parse(raw);
    const db = await getDb();
    const values = {
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      termsDays: input.termsDays ?? 30,
      taxExempt: input.taxExempt ?? false,
      notes: input.notes ?? null,
      active: input.active ?? true,
      billingAddress: pickAddress(raw, "bill"),
      shippingAddress: pickAddress(raw, "ship"),
      updatedAt: new Date(),
    };
    if (input.id) {
      await db.update(customers).set(values).where(and(eq(customers.id, input.id), eq(customers.orgId, ctx.orgId)));
      await audit(db, { orgId: ctx.orgId, userId: ctx.userId, action: "customer.update", entityType: "customer", entityId: input.id });
      revalidatePath(`/customers/${input.id}`);
      redirect(`/customers/${input.id}`);
    }
    const code = input.code || (await nextNumber(db, ctx.orgId, "customer"));
    const [row] = await db.insert(customers).values({ orgId: ctx.orgId, code, ...values }).returning();
    await audit(db, { orgId: ctx.orgId, userId: ctx.userId, action: "customer.create", entityType: "customer", entityId: row.id });
    redirect(`/customers/${row.id}`);
  });
}

const vendorSchema = z.object({
  id: optStr,
  code: optStr,
  name: reqStr,
  email: optStr,
  phone: optStr,
  termsDays: optNum,
  leadTimeDays: optNum,
  notes: optStr,
  active: bool.optional(),
});

export async function saveVendorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "master.edit");
    const raw = formObject(formData);
    const input = vendorSchema.parse(raw);
    const db = await getDb();
    const values = {
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      termsDays: input.termsDays ?? 30,
      leadTimeDays: input.leadTimeDays ?? 14,
      notes: input.notes ?? null,
      active: input.active ?? true,
      address: pickAddress(raw, "addr"),
      updatedAt: new Date(),
    };
    if (input.id) {
      await db.update(vendors).set(values).where(and(eq(vendors.id, input.id), eq(vendors.orgId, ctx.orgId)));
      revalidatePath(`/vendors/${input.id}`);
      redirect(`/vendors/${input.id}`);
    }
    const code = input.code || (await nextNumber(db, ctx.orgId, "vendor"));
    const [row] = await db.insert(vendors).values({ orgId: ctx.orgId, code, ...values }).returning();
    await audit(db, { orgId: ctx.orgId, userId: ctx.userId, action: "vendor.create", entityType: "vendor", entityId: row.id });
    redirect(`/vendors/${row.id}`);
  });
}

export async function addContactAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "master.edit");
    const input = z
      .object({ partyType: z.enum(["customer", "vendor", "lead"]), partyId: reqStr, name: reqStr, email: optStr, phone: optStr, title: optStr })
      .parse(formObject(formData));
    const db = await getDb();
    await db.insert(contacts).values({ orgId: ctx.orgId, ...input, email: input.email ?? null, phone: input.phone ?? null, title: input.title ?? null });
    const path = input.partyType === "customer" ? `/customers/${input.partyId}` : input.partyType === "vendor" ? `/vendors/${input.partyId}` : `/crm/${input.partyId}`;
    revalidatePath(path);
    return { ok: "Contact added." };
  });
}

export async function addActivityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    const input = z
      .object({ partyType: z.enum(["customer", "vendor", "lead"]), partyId: reqStr, type: z.enum(["call", "email", "meeting", "note", "visit"]).default("note"), summary: reqStr })
      .parse(formObject(formData));
    const db = await getDb();
    await db.insert(activities).values({ orgId: ctx.orgId, userId: ctx.userId, ...input });
    const path = input.partyType === "customer" ? `/customers/${input.partyId}` : input.partyType === "vendor" ? `/vendors/${input.partyId}` : `/crm/${input.partyId}`;
    revalidatePath(path);
    return { ok: "Logged." };
  });
}
