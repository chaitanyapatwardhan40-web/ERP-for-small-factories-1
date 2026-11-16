"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireOrg, assertCan } from "@/lib/tenancy";
import { formLines, formObject, optDate, optNum, optStr, reqStr, withFormErrors, dateStr } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";
import { acceptQuote, cancelOrder, changeOrderLine, confirmOrder, createOrder, createQuote, setQuoteStatus } from "./service";

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
});

export async function createQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const head = z.object({ customerId: reqStr, quoteDate: dateStr, validUntil: optDate, customerRfq: optStr, notes: optStr }).parse(formObject(formData));
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
  unitPrice: z.coerce.number().min(0),
  promisedDate: optDate,
});

export async function createOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const head = z
      .object({ customerId: reqStr, customerPo: optStr, program: optStr, orderDate: dateStr, promisedDate: optDate, notes: optStr, confirm: optStr })
      .parse(formObject(formData));
    const lines = z.array(orderLine).min(1, "Add at least one line").parse(formLines(formData));
    const db = await getDb();
    const order = await db.transaction(async (tx) => {
      const o = await createOrder(tx, ctx, { ...head, lines });
      if (head.confirm) await confirmOrder(tx, ctx, o.id);
      return o;
    });
    redirect(`/orders/${order.id}`);
  });
}

export async function confirmOrderAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "sales.edit");
  const id = String(formData.get("id") ?? "");
  const db = await getDb();
  await confirmOrder(db, ctx, id);
  revalidatePath(`/orders/${id}`);
}

export async function cancelOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const input = z.object({ id: reqStr, reason: reqStr }).parse(formObject(formData));
    const db = await getDb();
    await cancelOrder(db, ctx, input.id, input.reason);
    revalidatePath(`/orders/${input.id}`);
    return { ok: "Order cancelled." };
  });
}

export async function changeLineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "sales.edit");
    const input = z.object({ lineId: reqStr, orderId: reqStr, qty: optNum, unitPrice: optNum, promisedDate: optDate, reason: reqStr }).parse(formObject(formData));
    const db = await getDb();
    await db.transaction((tx) => changeOrderLine(tx, ctx, input.lineId, { qty: input.qty, unitPrice: input.unitPrice, promisedDate: input.promisedDate }, input.reason));
    revalidatePath(`/orders/${input.orderId}`);
    return { ok: "Line changed and logged." };
  });
}
