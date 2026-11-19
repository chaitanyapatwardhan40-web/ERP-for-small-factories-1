"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { orgs } from "@/lib/db/schema";
import { requireOrg, assertCan } from "@/lib/tenancy";
import { formLines, formObject, optDate, optNum, optStr, pickAddress, reqStr, withFormErrors, dateStr } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";
import {
  applyUnappliedPayment,
  createCreditMemo,
  createInvoiceFromShipment,
  createShipment,
  deleteDraftShipment,
  recordCustomerPayment,
  shipOrderInFull,
  shipShipment,
  updateShipmentDetails,
  voidInvoice,
} from "./service";

const method = z.enum(["check", "ach", "card", "cash", "other"]).default("check");

export async function shipInFullAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "inventory.edit");
    const input = z.object({ orderId: reqStr, locationId: reqStr, carrier: optStr, tracking: optStr, packages: optNum, weight: optNum, invoice: optStr }).parse(formObject(formData));
    const db = await getDb();
    const [org] = await db.select().from(orgs).where(eq(orgs.id, ctx.orgId));
    const sh = await db.transaction(async (tx) => {
      const s = await shipOrderInFull(tx, ctx, input.orderId, input.locationId, { carrier: input.carrier, tracking: input.tracking, packages: input.packages, weight: input.weight });
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
    const raw = formObject(formData);
    const head = z.object({ orderId: reqStr, locationId: reqStr, carrier: optStr, tracking: optStr, notes: optStr, packages: optNum, weight: optNum, freightCharge: optNum, ship: optStr }).parse(raw);
    const lines = z.array(z.object({ orderLineId: reqStr, qty: z.coerce.number().min(0), lotNumber: optStr, locationId: optStr })).parse(formLines(formData));
    const db = await getDb();
    const sh = await db.transaction(async (tx) => {
      const s = await createShipment(tx, ctx, {
        ...head,
        shipTo: pickAddress(raw, "shipTo"),
        lines: lines.map((l) => ({ orderLineId: l.orderLineId, qty: l.qty, locationId: l.locationId || head.locationId, lotNumber: l.lotNumber ?? null })),
      });
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

export async function updateShipmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "inventory.edit");
    const input = z.object({ id: reqStr, carrier: optStr, tracking: optStr, packages: optNum, weight: optNum, freightCharge: optNum, notes: optStr }).parse(formObject(formData));
    const db = await getDb();
    await updateShipmentDetails(db, ctx, input.id, { carrier: input.carrier ?? null, tracking: input.tracking ?? null, packages: input.packages, weight: input.weight, freightCharge: input.freightCharge, notes: input.notes ?? null });
    revalidatePath(`/shipments/${input.id}`);
    return { ok: "Shipment updated." };
  });
}

export async function deleteShipmentAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "inventory.edit");
  const id = String(formData.get("id") ?? "");
  const db = await getDb();
  const orderId = String(formData.get("orderId") ?? "");
  await db.transaction((tx) => deleteDraftShipment(tx, ctx, id));
  redirect(orderId ? `/orders/${orderId}` : "/shipments");
}

export async function invoiceShipmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const input = z.object({ shipmentId: reqStr, issueDate: optDate, dueDate: optDate, taxRatePct: optNum, memo: optStr }).parse(formObject(formData));
    const db = await getDb();
    const [org] = await db.select().from(orgs).where(eq(orgs.id, ctx.orgId));
    const inv = await db.transaction((tx) =>
      createInvoiceFromShipment(tx, ctx, { shipmentId: input.shipmentId, issueDate: input.issueDate, dueDate: input.dueDate ?? null, taxRatePct: input.taxRatePct ?? org?.settings.defaultTaxRatePct ?? 0, memo: input.memo ?? null }),
    );
    redirect(`/invoices/${inv.id}`);
  });
}

export async function customerPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "books.edit");
    const input = z.object({ invoiceId: reqStr, amount: z.coerce.number().positive(), paidAt: dateStr, method, reference: optStr, memo: optStr }).parse(formObject(formData));
    const db = await getDb();
    await db.transaction((tx) => recordCustomerPayment(tx, ctx, input));
    revalidatePath(`/invoices/${input.invoiceId}`);
    redirect(`/invoices/${input.invoiceId}`);
  });
}

/** One payment across several invoices (from the Receive payment screen). */
export async function receivePaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "books.edit");
    const head = z.object({ customerId: reqStr, amount: z.coerce.number().positive(), paidAt: dateStr, method, reference: optStr, memo: optStr }).parse(formObject(formData));
    const apps = z.array(z.object({ invoiceId: reqStr, amount: optNum })).parse(formLines(formData, "apply"));
    const db = await getDb();
    const pay = await db.transaction((tx) =>
      recordCustomerPayment(tx, ctx, { ...head, applications: apps.filter((a) => (a.amount ?? 0) > 0).map((a) => ({ invoiceId: a.invoiceId, amount: a.amount! })) }),
    );
    redirect(`/invoices?paid=${pay.number}`);
  });
}

export async function applyCreditAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "books.edit");
    const input = z.object({ paymentId: reqStr, invoiceId: reqStr, amount: z.coerce.number().positive() }).parse(formObject(formData));
    const db = await getDb();
    await db.transaction((tx) => applyUnappliedPayment(tx, ctx, input.paymentId, input.invoiceId, input.amount));
    revalidatePath(`/invoices/${input.invoiceId}`);
    return { ok: "Credit applied." };
  });
}

export async function creditMemoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "books.edit");
    const input = z.object({ invoiceId: reqStr, amount: z.coerce.number().positive(), reason: reqStr, issueDate: optDate, restockItemId: optStr, restockQty: optNum, restockLocationId: optStr }).parse(formObject(formData));
    const db = await getDb();
    const cm = await db.transaction((tx) =>
      createCreditMemo(tx, ctx, {
        invoiceId: input.invoiceId,
        amount: input.amount,
        reason: input.reason,
        issueDate: input.issueDate,
        restock: input.restockItemId && input.restockQty && input.restockLocationId ? [{ itemId: input.restockItemId, qty: input.restockQty, locationId: input.restockLocationId }] : [],
      }),
    );
    redirect(`/invoices/${cm.id}`);
  });
}

export async function voidInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "books.edit");
    const input = z.object({ invoiceId: reqStr, reason: reqStr }).parse(formObject(formData));
    const db = await getDb();
    await db.transaction((tx) => voidInvoice(tx, ctx, input.invoiceId, input.reason));
    redirect(`/invoices/${input.invoiceId}`);
  });
}
