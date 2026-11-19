"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

// --- Templates, bank, budgets ---------------------------------------------------

export async function saveTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "books.edit");
    const head = z.object({ id: optStr, name: reqStr, memo: optStr, frequency: z.enum(["none", "weekly", "monthly", "quarterly", "yearly"]).default("monthly"), nextDate: optStr }).parse(formObject(formData));
    const lines = z
      .array(z.object({ accountId: reqStr, debit: z.coerce.number().min(0).default(0), credit: z.coerce.number().min(0).default(0), memo: optStr }))
      .min(2, "A template needs at least two lines")
      .parse(formLines(formData));
    const db = await getDb();
    const { saveTemplate } = await import("./extras");
    await saveTemplate(db, ctx, { ...head, nextDate: head.nextDate || null, lines });
    revalidatePath("/books/recurring");
    return { ok: "Template saved." };
  });
}

export async function postTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "books.edit");
    const input = z.object({ id: reqStr, date: dateStr }).parse(formObject(formData));
    const db = await getDb();
    const { postTemplate } = await import("./extras");
    await db.transaction((tx) => postTemplate(tx, ctx, input.id, input.date));
    revalidatePath("/books/recurring");
    revalidatePath("/books");
    return { ok: "Posted." };
  });
}

export async function deleteTemplateAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "books.edit");
  const db = await getDb();
  const { deleteTemplate } = await import("./extras");
  await deleteTemplate(db, ctx, String(formData.get("id") ?? ""));
  revalidatePath("/books/recurring");
}

export async function importBankAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "books.edit");
    const file = formData.get("file");
    const accountId = String(formData.get("accountId") ?? "") || null;
    if (!(file instanceof File) || !file.size) return { error: "Choose a CSV file" };
    const text = await file.text();
    const Papa = (await import("papaparse")).default;
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    const norm = (k: string) => k.trim().toLowerCase().replace(/[^a-z]/g, "");
    const lines = parsed.data
      .map((row) => {
        const get = (...names: string[]) => {
          for (const [k, v] of Object.entries(row)) if (names.includes(norm(k))) return v;
          return undefined;
        };
        const date = get("date", "posteddate", "transactiondate", "postingdate") ?? "";
        const desc = get("description", "memo", "payee", "name", "details") ?? "";
        const amountRaw = get("amount", "transactionamount");
        const debit = get("debit", "withdrawal", "withdrawals", "moneyout");
        const credit = get("credit", "deposit", "deposits", "moneyin");
        const num = (s?: string) => (s == null || s.trim() === "" ? 0 : Number(s.replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1")));
        const amount = amountRaw != null ? num(amountRaw) : num(credit) - num(debit);
        const d = new Date(date);
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
        return { postedAt: iso, description: desc, amount, reference: get("reference", "checknumber", "check", "ref") ?? null };
      })
      .filter((l) => l.postedAt && l.description);
    if (!lines.length) return { error: "No rows recognised. Expected columns: date, description, amount (or debit/credit)." };
    const db = await getDb();
    const { importBankLines, autoMatchBank } = await import("./extras");
    const r = await importBankLines(db, ctx, accountId, lines);
    const matched = await autoMatchBank(db, ctx);
    revalidatePath("/books/bank");
    return { ok: `Imported ${r.added} lines (${r.skipped} duplicates skipped); ${matched} matched automatically.` };
  });
}

export async function matchBankAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "books.edit");
  const lineId = String(formData.get("lineId") ?? "");
  const value = String(formData.get("match") ?? "");
  const db = await getDb();
  const { matchBankLine } = await import("./extras");
  if (!value) await matchBankLine(db, ctx, lineId, null, null);
  else {
    const [type, id] = value.split(":");
    await matchBankLine(db, ctx, lineId, type, id);
  }
  revalidatePath("/books/bank");
}

export async function reconcileEntryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "books.edit");
    const input = z.object({ lineId: reqStr, offsetAccountId: reqStr, cashAccountId: reqStr }).parse(formObject(formData));
    const db = await getDb();
    const { reconcileAsEntry } = await import("./extras");
    await db.transaction((tx) => reconcileAsEntry(tx, ctx, input.lineId, input.offsetAccountId, input.cashAccountId));
    // The line leaves the unmatched list, so its form unmounts; show the result as a toast.
    redirect(`/books/bank?assistant=${encodeURIComponent("Posted and reconciled.")}`);
  });
}

export async function autoMatchAction() {
  const ctx = await requireOrg();
  assertCan(ctx, "books.edit");
  const db = await getDb();
  const { autoMatchBank } = await import("./extras");
  await autoMatchBank(db, ctx);
  revalidatePath("/books/bank");
}

export async function saveBudgetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "books.edit");
    const input = z.object({ accountId: reqStr, year: z.coerce.number().int(), yearly: z.coerce.number() }).parse(formObject(formData));
    const db = await getDb();
    const { setYearlyBudget } = await import("./extras");
    await setYearlyBudget(db, ctx, input.accountId, input.year, input.yearly);
    revalidatePath("/books/budgets");
    return { ok: "Budget saved and spread over twelve months." };
  });
}

export async function saveBudgetMonthAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "books.edit");
  const accountId = String(formData.get("accountId") ?? "");
  const year = Number(formData.get("year"));
  const db = await getDb();
  const { upsertBudget } = await import("./extras");
  for (let m = 1; m <= 12; m++) {
    const v = formData.get(`m${m}`);
    if (v === null || v === "") continue;
    await upsertBudget(db, ctx, { accountId, year, month: m, amount: Number(v) });
  }
  revalidatePath("/books/budgets");
}
