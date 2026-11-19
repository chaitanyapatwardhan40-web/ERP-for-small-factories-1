"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireOrg, assertCan } from "@/lib/tenancy";
import { bool, formLines, formObject, optDate, optNum, optStr, pickAddress, reqStr, withFormErrors, dateStr } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";
import {
  acceptQuote,
  addOrderLine,
  cancelOrder,
  cancelOrderLine,
  changeOrderLine,
  confirmOrder,
  createOrder,
  createQuote,
  deleteOrder,
  deleteQuote,
  setQuoteStatus,
  updateDraftOrder,
  updateOrderHeader,
  updateQuote,
  type OrderLineInput,
} from "./service";

const quoteLine = z.object({
  itemId: optStr,
  description: reqStr,
  qty: z.coerce.number().positive(),
  unitPrice: optNum,
  materialCost: optNum,
  laborCost: optNum,
  outsideCost: optNum,
  overheadCost: optNum,
  marginPct: optNum,
  leadTimeDays: optNum,
  discountPct: optNum,
  notes: optStr,
});

const quoteHead = z.object({ id: optStr, leadId: optStr, customerId: reqStr, quoteDate: dateStr, validUntil: optDate, customerRfq: optStr, contactName: optStr, terms: optStr, discountPct: optNum, notes: optStr });

export async function createQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const head = quoteHead.parse(formObject(formData));
    const lines = z.array(quoteLine).min(1, "Add at least one line").parse(formLines(formData));
    const db = await getDb();
    const quote = await db.transaction((tx) =>
      createQuote(tx, ctx, {
        ...head,
        lines: lines.map((l) => ({ ...l, itemId: l.itemId || null })),
      }),
    );
    redirect(`/quotes/${quote.id}`);
  });
}

export async function updateQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const head = quoteHead.parse(formObject(formData));
    if (!head.id) throw new Error("Missing quote id");
    const lines = z.array(quoteLine).min(1, "Add at least one line").parse(formLines(formData));
    const db = await getDb();
    await db.transaction((tx) => updateQuote(tx, ctx, head.id!, { ...head, lines: lines.map((l) => ({ ...l, itemId: l.itemId || null })) }));
    redirect(`/quotes/${head.id}`);
  });
}

export async function quoteStatusAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "sales.edit");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as "sent" | "lost" | "expired" | "draft";
  const reason = String(formData.get("reason") ?? "");
  const db = await getDb();
  await setQuoteStatus(db, ctx, id, status, reason || undefined);
  revalidatePath(`/quotes/${id}`);
}

export async function acceptQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const input = z.object({ id: reqStr, customerPo: optStr }).parse(formObject(formData));
    const db = await getDb();
    const order = await db.transaction((tx) => acceptQuote(tx, ctx, input.id, input.customerPo ?? null));
    redirect(`/orders/${order.id}`);
  });
}

const orderLine = z.object({
  itemId: reqStr,
  description: optStr,
  qty: z.coerce.number().positive(),
  unitPrice: optNum,
  discountPct: optNum,
  promisedDate: optDate,
  notes: optStr,
});

const orderHead = z.object({
  id: optStr,
  customerId: reqStr,
  customerPo: optStr,
  program: optStr,
  orderDate: dateStr,
  promisedDate: optDate,
  requestedDate: optDate,
  shipVia: optStr,
  freight: optNum,
  discountPct: optNum,
  termsDays: optNum,
  salesRep: optStr,
  notes: optStr,
  internalNotes: optStr,
  confirm: optStr,
});

function toOrderLines(lines: z.infer<typeof orderLine>[]): OrderLineInput[] {
  return lines.map((l) => ({ itemId: l.itemId, description: l.description ?? null, qty: l.qty, unitPrice: l.unitPrice ?? null, discountPct: l.discountPct ?? null, promisedDate: l.promisedDate ?? null, notes: l.notes ?? null }));
}

export async function createOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const raw = formObject(formData);
    const head = orderHead.parse(raw);
    const lines = z.array(orderLine).min(1, "Add at least one line").parse(formLines(formData));
    const db = await getDb();
    const order = await db.transaction(async (tx) => {
      const o = await createOrder(tx, ctx, { ...head, shipTo: pickAddress(raw, "shipTo"), lines: toOrderLines(lines) });
      if (head.confirm) await confirmOrder(tx, ctx, o.id);
      return o;
    });
    redirect(`/orders/${order.id}`);
  });
}

export async function updateOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const raw = formObject(formData);
    const head = orderHead.parse(raw);
    if (!head.id) throw new Error("Missing order id");
    const lines = z.array(orderLine).min(1, "Add at least one line").parse(formLines(formData));
    const db = await getDb();
    await db.transaction((tx) => updateDraftOrder(tx, ctx, head.id!, { ...head, shipTo: pickAddress(raw, "shipTo"), lines: toOrderLines(lines) }));
    redirect(`/orders/${head.id}`);
  });
}

export async function updateOrderHeaderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const raw = formObject(formData);
    const input = z
      .object({ orderId: reqStr, customerPo: optStr, program: optStr, promisedDate: optDate, requestedDate: optDate, shipVia: optStr, freight: optNum, salesRep: optStr, notes: optStr, internalNotes: optStr, reason: optStr })
      .parse(raw);
    const db = await getDb();
    await db.transaction((tx) =>
      updateOrderHeader(
        tx,
        ctx,
        input.orderId,
        {
          customerPo: input.customerPo ?? null,
          program: input.program ?? null,
          promisedDate: input.promisedDate ?? null,
          requestedDate: input.requestedDate ?? null,
          shipTo: pickAddress(raw, "shipTo") ?? undefined,
          shipVia: input.shipVia ?? null,
          freight: input.freight ?? null,
          salesRep: input.salesRep ?? null,
          notes: input.notes ?? null,
          internalNotes: input.internalNotes ?? null,
        },
        input.reason || "header updated",
      ),
    );
    revalidatePath(`/orders/${input.orderId}`);
    return { ok: "Order updated." };
  });
}

export async function confirmOrderAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "sales.edit");
  const id = String(formData.get("id") ?? "");
  const override = String(formData.get("overrideCredit") ?? "") === "on";
  if (override && ctx.role !== "owner") throw new Error("Only an owner can override a credit hold");
  const db = await getDb();
  await db.transaction((tx) => confirmOrder(tx, ctx, id, { overrideCredit: override }));
  revalidatePath(`/orders/${id}`);
}

export async function confirmOrderFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const input = z.object({ id: reqStr, overrideCredit: bool.optional() }).parse(formObject(formData));
    if (input.overrideCredit && ctx.role !== "owner") throw new Error("Only an owner can override a credit hold");
    const db = await getDb();
    await db.transaction((tx) => confirmOrder(tx, ctx, input.id, { overrideCredit: !!input.overrideCredit }));
    // The draft card unmounts once the order is confirmed, so land on the fresh page.
    redirect(`/orders/${input.id}`);
  });
}

export async function cancelOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const input = z.object({ id: reqStr, reason: reqStr }).parse(formObject(formData));
    const db = await getDb();
    await db.transaction((tx) => cancelOrder(tx, ctx, input.id, input.reason));
    revalidatePath(`/orders/${input.id}`);
    return { ok: "Order cancelled." };
  });
}

export async function changeLineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const input = z.object({ lineId: reqStr, orderId: reqStr, qty: optNum, unitPrice: optNum, discountPct: optNum, promisedDate: optDate, reason: reqStr }).parse(formObject(formData));
    const db = await getDb();
    await db.transaction((tx) => changeOrderLine(tx, ctx, input.lineId, { qty: input.qty, unitPrice: input.unitPrice, discountPct: input.discountPct, promisedDate: input.promisedDate }, input.reason));
    revalidatePath(`/orders/${input.orderId}`);
    return { ok: "Line changed and logged." };
  });
}

export async function addLineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const input = z.object({ orderId: reqStr, itemId: reqStr, qty: z.coerce.number().positive(), unitPrice: optNum, discountPct: optNum, promisedDate: optDate, reason: optStr }).parse(formObject(formData));
    const db = await getDb();
    await db.transaction((tx) => addOrderLine(tx, ctx, input.orderId, { itemId: input.itemId, qty: input.qty, unitPrice: input.unitPrice ?? null, discountPct: input.discountPct ?? null, promisedDate: input.promisedDate ?? null }, input.reason || "line added"));
    revalidatePath(`/orders/${input.orderId}`);
    return { ok: "Line added." };
  });
}

export async function cancelLineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const input = z.object({ lineId: reqStr, orderId: reqStr, reason: reqStr }).parse(formObject(formData));
    const db = await getDb();
    await db.transaction((tx) => cancelOrderLine(tx, ctx, input.lineId, input.reason));
    revalidatePath(`/orders/${input.orderId}`);
    return { ok: "Open quantity cancelled." };
  });
}

export async function deleteQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const id = String(formData.get("id") ?? "");
    const db = await getDb();
    const q = await db.transaction((tx) => deleteQuote(tx, ctx, id));
    redirect(`/quotes?assistant=${encodeURIComponent(`${q.number} deleted.`)}`);
  });
}

export async function deleteOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const id = String(formData.get("id") ?? "");
    const db = await getDb();
    const o = await db.transaction((tx) => deleteOrder(tx, ctx, id));
    redirect(`/orders?assistant=${encodeURIComponent(`${o.number} deleted.`)}`);
  });
}
