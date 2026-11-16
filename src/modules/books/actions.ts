"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { accounts, ACCOUNT_SUBTYPES, ACCOUNT_TYPES, periods, postingRules } from "@/lib/db/schema";
import { requireOrg, assertCan } from "@/lib/tenancy";
import { audit } from "@/lib/audit";
import { bool, dateStr, formLines, formObject, optStr, reqStr, withFormErrors } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";
import { postJournal, reverseEntry } from "./service";
import { today } from "@/lib/money";

export async function postJournalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "books.edit");
    const head = z.object({ date: dateStr, memo: reqStr }).parse(formObject(formData));
    const lines = z
      .array(z.object({ accountId: reqStr, debit: z.coerce.number().min(0).default(0), credit: z.coerce.number().min(0).default(0), memo: optStr }))
      .min(2, "A journal entry needs at least two lines")
      .parse(formLines(formData));
    const db = await getDb();
    const id = await db.transaction((tx) => postJournal(tx, { orgId: ctx.orgId, date: head.date, memo: head.memo, lines }));
    await audit(db, { orgId: ctx.orgId, userId: ctx.userId, action: "journal.post", entityType: "journal", entityId: id });
    revalidatePath("/books");
    return { ok: "Posted." };
  });
}

export async function reverseEntryAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "books.edit");
  const id = String(formData.get("id") ?? "");
  const db = await getDb();
  await db.transaction((tx) => reverseEntry(tx, ctx.orgId, id, today()));
  await audit(db, { orgId: ctx.orgId, userId: ctx.userId, action: "journal.reverse", entityType: "journal", entityId: id });
  revalidatePath("/books");
}

export async function saveAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "books.edit");
    const input = z.object({ id: optStr, code: reqStr, name: reqStr, type: z.enum(ACCOUNT_TYPES), subtype: z.enum(ACCOUNT_SUBTYPES).default("other"), active: bool.optional() }).parse(formObject(formData));
    const db = await getDb();
    const values = { code: input.code, name: input.name, type: input.type, subtype: input.subtype, active: input.active ?? true, updatedAt: new Date() };
    if (input.id) await db.update(accounts).set(values).where(and(eq(accounts.id, input.id), eq(accounts.orgId, ctx.orgId)));
    else await db.insert(accounts).values({ orgId: ctx.orgId, ...values });
    revalidatePath("/books/accounts");
    return { ok: "Account saved." };
  });
}

export async function savePostingRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "books.edit");
    const input = z.object({ id: reqStr, debitSubtype: z.enum(ACCOUNT_SUBTYPES), creditSubtype: z.enum(ACCOUNT_SUBTYPES) }).parse(formObject(formData));
    const db = await getDb();
    await db.update(postingRules).set({ debitSubtype: input.debitSubtype, creditSubtype: input.creditSubtype, updatedAt: new Date() }).where(and(eq(postingRules.id, input.id), eq(postingRules.orgId, ctx.orgId)));
    await audit(db, { orgId: ctx.orgId, userId: ctx.userId, action: "posting_rule.update", entityType: "posting_rule", entityId: input.id, data: input });
    revalidatePath("/books/accounts");
    return { ok: "Rule saved." };
  });
}

export async function togglePeriodAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "books.edit");
  const id = String(formData.get("id") ?? "");
  const db = await getDb();
  const [p] = await db.select().from(periods).where(and(eq(periods.id, id), eq(periods.orgId, ctx.orgId)));
  if (p) {
    await db.update(periods).set({ locked: !p.locked, updatedAt: new Date() }).where(eq(periods.id, id));
    await audit(db, { orgId: ctx.orgId, userId: ctx.userId, action: p.locked ? "period.unlock" : "period.lock", entityType: "period", entityId: id });
  }
  revalidatePath("/books/accounts");
}
