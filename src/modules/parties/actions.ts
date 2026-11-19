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
import { bool, formObject, optNum, optStr, pickAddress, reqStr, withFormErrors } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";

const customerSchema = z.object({
  id: optStr,
  code: optStr,
  name: reqStr,
  email: optStr,
  phone: optStr,
  website: optStr,
  industry: optStr,
  termsDays: optNum,
  taxExempt: bool.optional(),
  taxCertNo: optStr,
  creditLimit: optNum,
  creditHold: bool.optional(),
  discountPct: optNum,
  salesRep: optStr,
  shipVia: optStr,
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
      taxCertNo: input.taxCertNo ?? null,
      website: input.website ?? null,
      industry: input.industry ?? null,
      creditLimit: input.creditLimit ?? 0,
      creditHold: input.creditHold ?? false,
      discountPct: input.discountPct ?? 0,
      salesRep: input.salesRep ?? null,
      shipVia: input.shipVia ?? null,
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
  website: optStr,
  termsDays: optNum,
  leadTimeDays: optNum,
  accountNo: optStr,
  paymentMethod: z.enum(["check", "ach", "card", "cash", "other"]).optional(),
  taxId: optStr,
  is1099: bool.optional(),
  shipVia: optStr,
  minOrder: optNum,
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
      website: input.website ?? null,
      accountNo: input.accountNo ?? null,
      paymentMethod: input.paymentMethod ?? "check",
      taxId: input.taxId ?? null,
      is1099: input.is1099 ?? false,
      shipVia: input.shipVia ?? null,
      minOrder: input.minOrder ?? 0,
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
      .object({ partyType: z.enum(["customer", "vendor", "lead"]), partyId: reqStr, type: z.enum(["call", "email", "meeting", "note", "visit"]).default("note"), summary: reqStr, dueAt: optStr })
      .parse(formObject(formData));
    const db = await getDb();
    const { dueAt, ...rest } = input;
    await db.insert(activities).values({ orgId: ctx.orgId, userId: ctx.userId, ...rest, dueAt: dueAt ? new Date(`${dueAt}T09:00:00`) : null, done: !dueAt });
    const path = input.partyType === "customer" ? `/customers/${input.partyId}` : input.partyType === "vendor" ? `/vendors/${input.partyId}` : `/crm/${input.partyId}`;
    revalidatePath(path);
    return { ok: "Logged." };
  });
}

const addressSchema = z.object({ customerId: reqStr, label: reqStr, isDefault: bool.optional() });

export async function saveCustomerAddressAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "master.edit");
    const raw = formObject(formData);
    const input = addressSchema.parse(raw);
    const address = pickAddress(raw, "addr");
    if (!address) throw new Error("Enter at least a street or city");
    const db = await getDb();
    const { customerAddresses } = await import("@/lib/db/schema");
    const [c] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, input.customerId), eq(customers.orgId, ctx.orgId)));
    if (!c) throw new Error("Customer not found");
    if (input.isDefault) await db.update(customerAddresses).set({ isDefault: false }).where(eq(customerAddresses.customerId, c.id));
    await db.insert(customerAddresses).values({ orgId: ctx.orgId, customerId: c.id, label: input.label, address, isDefault: input.isDefault ?? false });
    revalidatePath(`/customers/${c.id}`);
    return { ok: "Address added." };
  });
}

export async function deleteCustomerAddressAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "master.edit");
  const id = String(formData.get("id") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const db = await getDb();
  const { customerAddresses } = await import("@/lib/db/schema");
  await db.delete(customerAddresses).where(and(eq(customerAddresses.id, id), eq(customerAddresses.orgId, ctx.orgId)));
  revalidatePath(`/customers/${customerId}`);
}

const priceSchema = z.object({ customerId: optStr, itemId: reqStr, minQty: optNum, unitPrice: z.coerce.number().min(0), validFrom: optStr, validTo: optStr, returnTo: optStr });

export async function saveCustomerPriceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const input = priceSchema.parse(formObject(formData));
    const db = await getDb();
    const { customerPrices } = await import("@/lib/db/schema");
    await db.insert(customerPrices).values({
      orgId: ctx.orgId,
      customerId: input.customerId || null,
      itemId: input.itemId,
      minQty: input.minQty ?? 0,
      unitPrice: input.unitPrice,
      validFrom: input.validFrom || null,
      validTo: input.validTo || null,
    });
    revalidatePath(input.returnTo ?? "/customers");
    return { ok: "Price saved." };
  });
}

export async function deleteCustomerPriceAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "sales.edit");
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/customers");
  const db = await getDb();
  const { customerPrices } = await import("@/lib/db/schema");
  await db.delete(customerPrices).where(and(eq(customerPrices.id, id), eq(customerPrices.orgId, ctx.orgId)));
  revalidatePath(returnTo);
}

export async function completeActivityAction(formData: FormData) {
  const ctx = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/");
  const db = await getDb();
  await db.update(activities).set({ done: true, updatedAt: new Date() }).where(and(eq(activities.id, id), eq(activities.orgId, ctx.orgId)));
  revalidatePath(returnTo);
}
