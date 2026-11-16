"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { orgs } from "@/lib/db/schema";
import { requireOrg, assertCan } from "@/lib/tenancy";
import { formLines, formObject, optDate, optNum, optStr, reqStr, withFormErrors, dateStr } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";
import { createInvoiceFromShipment, createShipment, recordCustomerPayment, shipOrderInFull, shipShipment } from "./service";

export async function shipInFullAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "inventory.edit");
    const input = z.object({ orderId: reqStr, locationId: reqStr, carrier: optStr, tracking: optStr, invoice: optStr }).parse(formObject(formData));
    const db = await getDb();
    const [org] = await db.select().from(orgs).where(eq(orgs.id, ctx.orgId));
    const sh = await db.transaction(async (tx) => {
      const s = await shipOrderInFull(tx, ctx, input.orderId, input.locationId, { carrier: input.carrier, tracking: input.tracking });
      if (input.invoice) await createInvoiceFromShipment(tx, ctx, { shipmentId: s.id, taxRatePct: org?.settings.defaultTaxRatePct ?? 0 });
      return s;
    });
    redirect(`/shipments/${sh.id}`);
  });
}

export async function createShipmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "inventory.edit");
    const head = z.object({ orderId: reqStr, locationId: reqStr, carrier: optStr, tracking: optStr, notes: optStr, ship: optStr }).parse(formObject(formData));
    const lines = z.array(z.object({ orderLineId: reqStr, qty: z.coerce.number().min(0), lotNumber: optStr })).parse(formLines(formData));
    const db = await getDb();
    const sh = await db.transaction(async (tx) => {
      const s = await createShipment(tx, ctx, { ...head, lines: lines.map((l) => ({ ...l, locationId: head.locationId, lotNumber: l.lotNumber ?? null })) });
      if (head.ship) await shipShipment(tx, ctx, s.id);
      return s;
    });
    redirect(`/shipments/${sh.id}`);
  });
}

export async function shipShipmentAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "inventory.edit");
  const id = String(formData.get("id") ?? "");
  const db = await getDb();
  await db.transaction((tx) => shipShipment(tx, ctx, id));
  revalidatePath(`/shipments/${id}`);
}

export async function invoiceShipmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const input = z.object({ shipmentId: reqStr, issueDate: optDate, dueDate: optDate, taxRatePct: optNum }).parse(formObject(formData));
    const db = await getDb();
    const [org] = await db.select().from(orgs).where(eq(orgs.id, ctx.orgId));
    const inv = await db.transaction((tx) =>
      createInvoiceFromShipment(tx, ctx, { shipmentId: input.shipmentId, issueDate: input.issueDate, dueDate: input.dueDate ?? null, taxRatePct: input.taxRatePct ?? org?.settings.defaultTaxRatePct ?? 0 }),
    );
    redirect(`/invoices/${inv.id}`);
  });
}

export async function customerPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "books.edit");
    const input = z
      .object({ invoiceId: reqStr, amount: z.coerce.number().positive(), paidAt: dateStr, method: z.enum(["check", "ach", "card", "cash", "other"]).default("check"), reference: optStr })
      .parse(formObject(formData));
    const db = await getDb();
    await db.transaction((tx) => recordCustomerPayment(tx, ctx, input));
    revalidatePath(`/invoices/${input.invoiceId}`);
    return { ok: "Payment recorded." };
  });
}
