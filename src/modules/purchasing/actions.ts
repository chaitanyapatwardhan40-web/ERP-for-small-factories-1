"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireOrg, assertCan } from "@/lib/tenancy";
import { bool, formLines, formObject, optDate, optNum, optStr, pickAddress, reqStr, withFormErrors, dateStr } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";
import { ACCOUNT_SUBTYPES } from "@/lib/db/schema";
import {
  createBillFromPo,
  createExpenseBill,
  createPurchaseOrder,
  deleteVendorItem,
  payBill,
  receivePurchaseOrder,
  setPoStatus,
  shortageReport,
  updatePurchaseOrder,
  upsertVendorItem,
  voidBill,
  type PoLineInput,
} from "./service";
import { today } from "@/lib/money";

const poLine = z.object({
  itemId: optStr,
  description: optStr,
  vendorPartNo: optStr,
  qty: z.coerce.number().positive("Quantity must be positive"),
  unitPrice: optNum,
  expectedDate: optDate,
  notes: optStr,
});

const poHead = z.object({
  id: optStr,
  vendorId: reqStr,
  orderDate: dateStr,
  expectedDate: optDate,
  vendorRef: optStr,
  termsDays: optNum,
  shipVia: optStr,
  freight: optNum,
  tax: optNum,
  notes: optStr,
  internalNotes: optStr,
  workOrderId: optStr,
  send: optStr,
});

function toLines(lines: z.infer<typeof poLine>[]): PoLineInput[] {
  return lines.map((l) => ({
    itemId: l.itemId || null,
    description: l.description ?? null,
    vendorPartNo: l.vendorPartNo ?? null,
    qty: l.qty,
    unitCost: l.unitPrice ?? null,
    expectedDate: l.expectedDate ?? null,
    notes: l.notes ?? null,
  }));
}

export async function createPoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "purchasing.edit");
    const raw = formObject(formData);
    const head = poHead.parse(raw);
    const lines = z.array(poLine).min(1, "Add at least one line").parse(formLines(formData));
    const db = await getDb();
    const po = await db.transaction(async (tx) => {
      const p = await createPurchaseOrder(tx, ctx, {
        vendorId: head.vendorId,
        orderDate: head.orderDate,
        expectedDate: head.expectedDate ?? null,
        vendorRef: head.vendorRef ?? null,
        termsDays: head.termsDays ?? null,
        shipVia: head.shipVia ?? null,
        freight: head.freight ?? 0,
        tax: head.tax ?? 0,
        shipTo: pickAddress(raw, "shipTo"),
        notes: head.notes ?? null,
        internalNotes: head.internalNotes ?? null,
        workOrderId: head.workOrderId || null,
        lines: toLines(lines),
      });
      if (head.send) await setPoStatus(tx, ctx, p.id, "sent");
      return p;
    });
    redirect(`/purchasing/${po.id}`);
  });
}

export async function updatePoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "purchasing.edit");
    const raw = formObject(formData);
    const head = poHead.parse(raw);
    if (!head.id) throw new Error("Missing PO id");
    const lines = z.array(poLine).min(1, "Add at least one line").parse(formLines(formData));
    const db = await getDb();
    await db.transaction((tx) =>
      updatePurchaseOrder(tx, ctx, head.id!, {
        vendorId: head.vendorId,
        orderDate: head.orderDate,
        expectedDate: head.expectedDate ?? null,
        vendorRef: head.vendorRef ?? null,
        termsDays: head.termsDays ?? null,
        shipVia: head.shipVia ?? null,
        freight: head.freight ?? 0,
        tax: head.tax ?? 0,
        shipTo: pickAddress(raw, "shipTo"),
        notes: head.notes ?? null,
        internalNotes: head.internalNotes ?? null,
        lines: toLines(lines),
      }),
    );
    redirect(`/purchasing/${head.id}`);
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
  const reason = String(formData.get("reason") ?? "") || undefined;
  const db = await getDb();
  await db.transaction((tx) => setPoStatus(tx, ctx, id, status, { confirmedDate, vendorRef, reason }));
  revalidatePath(`/purchasing/${id}`);
}

export async function receivePoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "inventory.edit");
    const head = z.object({ poId: reqStr, locationId: reqStr, packingSlip: optStr, notes: optStr, bill: optStr, receivedAt: optDate }).parse(formObject(formData));
    const lines = z.array(z.object({ poLineId: reqStr, qty: z.coerce.number().min(0), lotNumber: optStr, locationId: optStr })).parse(formLines(formData));
    const db = await getDb();
    await db.transaction(async (tx) => {
      await receivePurchaseOrder(tx, ctx, {
        poId: head.poId,
        receivedAt: head.receivedAt ? new Date(`${head.receivedAt}T12:00:00`) : undefined,
        packingSlip: head.packingSlip ?? null,
        notes: head.notes ?? null,
        lines: lines.map((l) => ({ poLineId: l.poLineId, qty: l.qty, lotNumber: l.lotNumber ?? null, locationId: l.locationId || head.locationId })),
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
    const input = z.object({ poId: reqStr, billDate: dateStr, dueDate: optDate, vendorRef: optStr, tax: optNum, freight: optNum, notes: optStr }).parse(formObject(formData));
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
      .object({ vendorId: reqStr, billDate: dateStr, dueDate: optDate, vendorRef: optStr, description: reqStr, amount: z.coerce.number().positive(), expenseSubtype: z.enum(ACCOUNT_SUBTYPES).optional(), notes: optStr })
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
    redirect(`/bills/${input.billId}`);
  });
}

export async function voidBillAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "books.edit");
    const input = z.object({ billId: reqStr, reason: reqStr }).parse(formObject(formData));
    const db = await getDb();
    await db.transaction((tx) => voidBill(tx, ctx, input.billId, input.reason));
    redirect(`/bills/${input.billId}`);
  });
}

export async function saveVendorItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "purchasing.edit");
    const input = z
      .object({ vendorId: reqStr, itemId: reqStr, vendorPartNo: optStr, lastCost: optNum, leadTimeDays: optNum, minQty: optNum, preferred: bool.optional() })
      .parse(formObject(formData));
    const db = await getDb();
    await db.transaction((tx) => upsertVendorItem(tx, ctx, { ...input, preferred: !!input.preferred }));
    revalidatePath(`/vendors/${input.vendorId}`);
    revalidatePath(`/items/${input.itemId}`);
    return { ok: "Price list updated." };
  });
}

export async function deleteVendorItemAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "purchasing.edit");
  const id = String(formData.get("id") ?? "");
  const vendorId = String(formData.get("vendorId") ?? "");
  const db = await getDb();
  await deleteVendorItem(db, ctx, id);
  revalidatePath(`/vendors/${vendorId}`);
}
