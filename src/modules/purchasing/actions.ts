"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireOrg, assertCan } from "@/lib/tenancy";
import { formLines, formObject, optDate, optNum, optStr, reqStr, withFormErrors, dateStr } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";
import { ACCOUNT_SUBTYPES } from "@/lib/db/schema";
import { createBillFromPo, createExpenseBill, createPurchaseOrder, payBill, receivePurchaseOrder, setPoStatus, shortageReport } from "./service";
import { today } from "@/lib/money";

const poLine = z.object({ itemId: reqStr, description: optStr, qty: z.coerce.number().positive(), unitPrice: z.coerce.number().min(0), expectedDate: optDate });

export async function createPoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "purchasing.edit");
    const head = z.object({ vendorId: reqStr, orderDate: dateStr, expectedDate: optDate, notes: optStr, workOrderId: optStr, send: optStr }).parse(formObject(formData));
    const lines = z.array(poLine).min(1, "Add at least one line").parse(formLines(formData));
    const db = await getDb();
    const po = await db.transaction(async (tx) => {
      const p = await createPurchaseOrder(tx, ctx, {
        vendorId: head.vendorId,
        orderDate: head.orderDate,
        expectedDate: head.expectedDate ?? null,
        notes: head.notes ?? null,
        workOrderId: head.workOrderId || null,
        lines: lines.map((l) => ({ itemId: l.itemId, description: l.description, qty: l.qty, unitCost: l.unitPrice, expectedDate: l.expectedDate ?? null })),
      });
      if (head.send) await setPoStatus(tx, ctx, p.id, "sent");
      return p;
    });
    redirect(`/purchasing/${po.id}`);
  });
}

/** One PO per preferred vendor from the shortage report. */
export async function createPosFromShortagesAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "purchasing.edit");
  const selected = formData.getAll("itemId").map(String);
  const db = await getDb();
  const report = await shortageReport(db, ctx.orgId);
  const chosen = report.filter((r) => selected.includes(r.itemId) && r.preferredVendorId);
  const byVendor = new Map<string, typeof chosen>();
  for (const r of chosen) byVendor.set(r.preferredVendorId!, [...(byVendor.get(r.preferredVendorId!) ?? []), r]);
  const created: string[] = [];
  await db.transaction(async (tx) => {
    for (const [vendorId, rows] of byVendor) {
      const po = await createPurchaseOrder(tx, ctx, {
        vendorId,
        orderDate: today(),
        lines: rows.map((r) => ({ itemId: r.itemId, qty: r.suggestedQty, unitCost: r.lastCost })),
      });
      created.push(po.id);
    }
  });
  revalidatePath("/purchasing");
  if (created.length === 1) redirect(`/purchasing/${created[0]}`);
  redirect("/purchasing");
}

export async function poStatusAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "purchasing.edit");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as "sent" | "confirmed" | "cancelled" | "closed";
  const confirmedDate = String(formData.get("confirmedDate") ?? "") || undefined;
  const vendorRef = String(formData.get("vendorRef") ?? "") || undefined;
  const db = await getDb();
  await setPoStatus(db, ctx, id, status, { confirmedDate, vendorRef });
  revalidatePath(`/purchasing/${id}`);
}

export async function receivePoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "inventory.edit");
    const head = z.object({ poId: reqStr, locationId: reqStr, packingSlip: optStr, notes: optStr, bill: optStr }).parse(formObject(formData));
    const lines = z.array(z.object({ poLineId: reqStr, qty: z.coerce.number().min(0), lotNumber: optStr })).parse(formLines(formData));
    const db = await getDb();
    await db.transaction(async (tx) => {
      await receivePurchaseOrder(tx, ctx, {
        poId: head.poId,
        packingSlip: head.packingSlip ?? null,
        notes: head.notes ?? null,
        lines: lines.map((l) => ({ poLineId: l.poLineId, qty: l.qty, lotNumber: l.lotNumber ?? null, locationId: head.locationId })),
      });
      if (head.bill) await createBillFromPo(tx, ctx, { poId: head.poId, billDate: today() });
    });
    revalidatePath(`/purchasing/${head.poId}`);
    return { ok: "Received into stock." };
  });
}

export async function billPoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "books.edit");
    const input = z.object({ poId: reqStr, billDate: dateStr, dueDate: optDate, vendorRef: optStr, tax: optNum }).parse(formObject(formData));
    const db = await getDb();
    const bill = await db.transaction((tx) => createBillFromPo(tx, ctx, { ...input, dueDate: input.dueDate ?? null }));
    redirect(`/bills/${bill.id}`);
  });
}

export async function expenseBillAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "books.edit");
    const input = z
      .object({ vendorId: reqStr, billDate: dateStr, dueDate: optDate, vendorRef: optStr, description: reqStr, amount: z.coerce.number().positive(), expenseSubtype: z.enum(ACCOUNT_SUBTYPES).optional() })
      .parse(formObject(formData));
    const db = await getDb();
    const bill = await db.transaction((tx) => createExpenseBill(tx, ctx, { ...input, dueDate: input.dueDate ?? null }));
    redirect(`/bills/${bill.id}`);
  });
}

export async function payBillAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "books.edit");
    const input = z
      .object({ billId: reqStr, amount: z.coerce.number().positive(), paidAt: dateStr, method: z.enum(["check", "ach", "card", "cash", "other"]).default("check"), reference: optStr })
      .parse(formObject(formData));
    const db = await getDb();
    await db.transaction((tx) => payBill(tx, ctx, input));
    revalidatePath(`/bills/${input.billId}`);
    return { ok: "Payment recorded." };
  });
}
