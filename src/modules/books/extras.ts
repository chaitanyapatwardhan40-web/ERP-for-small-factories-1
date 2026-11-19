import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import {
  accounts,
  bankTransactions,
  budgets,
  customerPayments,
  invoices,
  journalEntries,
  journalLines,
  journalTemplates,
  purchaseOrderLines,
  purchaseOrders,
  vendorBills,
  vendorPayments,
  vendors,
  workOrders,
  type TemplateLine,
} from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { addDays, round4 } from "@/lib/money";
import { accountBalances, postJournal, PostingError } from "./service";

type Actor = { orgId: string; userId: string };

// --- Recurring / template entries ---------------------------------------------

export async function saveTemplate(
  db: DbOrTx,
  actor: Actor,
  input: { id?: string | null; name: string; memo?: string | null; frequency: "none" | "weekly" | "monthly" | "quarterly" | "yearly"; nextDate?: string | null; lines: TemplateLine[] },
) {
  const debits = round4(input.lines.reduce((s, l) => s + Number(l.debit || 0), 0));
  const credits = round4(input.lines.reduce((s, l) => s + Number(l.credit || 0), 0));
  if (debits !== credits || debits === 0) throw new PostingError(`Template does not balance: debits ${debits} vs credits ${credits}.`);
  const values = { name: input.name, memo: input.memo ?? null, frequency: input.frequency, nextDate: input.nextDate ?? null, lines: input.lines, updatedAt: new Date() };
  if (input.id) {
    await db.update(journalTemplates).set(values).where(and(eq(journalTemplates.id, input.id), eq(journalTemplates.orgId, actor.orgId)));
    return input.id;
  }
  const [row] = await db.insert(journalTemplates).values({ orgId: actor.orgId, ...values }).returning();
  return row.id;
}

function advance(date: string, frequency: string) {
  const d = new Date(`${date}T00:00:00`);
  if (frequency === "weekly") d.setDate(d.getDate() + 7);
  else if (frequency === "monthly") d.setMonth(d.getMonth() + 1);
  else if (frequency === "quarterly") d.setMonth(d.getMonth() + 3);
  else if (frequency === "yearly") d.setFullYear(d.getFullYear() + 1);
  else return null;
  return d.toISOString().slice(0, 10);
}

/** Post a template as a journal entry on a date and roll its next date forward. */
export async function postTemplate(db: DbOrTx, actor: Actor, templateId: string, date: string) {
  const [t] = await db.select().from(journalTemplates).where(and(eq(journalTemplates.id, templateId), eq(journalTemplates.orgId, actor.orgId)));
  if (!t) throw new PostingError("Template not found");
  const id = await postJournal(db, { orgId: actor.orgId, date, memo: t.memo ?? t.name, lines: t.lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit), memo: l.memo })) });
  await db
    .update(journalTemplates)
    .set({ lastPostedAt: date, nextDate: t.nextDate ? advance(t.nextDate, t.frequency) : null, updatedAt: new Date() })
    .where(eq(journalTemplates.id, t.id));
  await audit(db, { ...actor, action: "journal.template.post", entityType: "journal", entityId: id, data: { templateId: t.id } });
  return id;
}

export async function listTemplates(db: DbOrTx, orgId: string) {
  return db.select().from(journalTemplates).where(eq(journalTemplates.orgId, orgId)).orderBy(asc(journalTemplates.name));
}

export async function deleteTemplate(db: DbOrTx, actor: Actor, id: string) {
  await db.delete(journalTemplates).where(and(eq(journalTemplates.id, id), eq(journalTemplates.orgId, actor.orgId)));
}

// --- Bank reconciliation -------------------------------------------------------

export type BankLineInput = { postedAt: string; description: string; amount: number; reference?: string | null };

/** Import statement lines; duplicates (same date, amount, description) are skipped. */
export async function importBankLines(db: DbOrTx, actor: Actor, accountId: string | null, lines: BankLineInput[]) {
  const existing = await db.select().from(bankTransactions).where(eq(bankTransactions.orgId, actor.orgId));
  const key = (l: { postedAt: string; amount: number; description: string }) => `${l.postedAt}|${round4(Number(l.amount))}|${l.description.trim().toLowerCase()}`;
  const seen = new Set(existing.map((e) => key({ postedAt: e.postedAt, amount: Number(e.amount), description: e.description })));
  let added = 0;
  for (const l of lines) {
    if (!l.postedAt || !Number.isFinite(Number(l.amount))) continue;
    const k = key(l);
    if (seen.has(k)) continue;
    seen.add(k);
    await db.insert(bankTransactions).values({ orgId: actor.orgId, accountId, postedAt: l.postedAt, description: l.description.trim(), reference: l.reference ?? null, amount: round4(Number(l.amount)) });
    added++;
  }
  await audit(db, { ...actor, action: "bank.import", entityType: "bank", entityId: actor.orgId, data: { added, skipped: lines.length - added } });
  return { added, skipped: lines.length - added };
}

export type MatchCandidate = { type: "customer_payment" | "vendor_payment"; id: string; number: string; date: string; amount: number; who: string; days: number };

/** Bank lines with the payments that could explain them (same amount, within 7 days). */
export async function bankLinesWithCandidates(db: DbOrTx, orgId: string, opts: { onlyUnmatched?: boolean } = {}) {
  const lines = await db
    .select()
    .from(bankTransactions)
    .where(and(eq(bankTransactions.orgId, orgId), opts.onlyUnmatched ? eq(bankTransactions.reconciled, false) : undefined))
    .orderBy(desc(bankTransactions.postedAt))
    .limit(300);
  const [cps, vps] = await Promise.all([
    db.select({ p: customerPayments, who: sql<string>`(select name from customers c where c.id = ${customerPayments.customerId})` }).from(customerPayments).where(eq(customerPayments.orgId, orgId)),
    db.select({ p: vendorPayments, who: vendors.name }).from(vendorPayments).innerJoin(vendors, eq(vendors.id, vendorPayments.vendorId)).where(eq(vendorPayments.orgId, orgId)),
  ]);
  const matchedIds = new Set(lines.filter((l) => l.matchedId).map((l) => l.matchedId));
  const dayDiff = (a: string, b: string) => Math.abs((new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86_400_000);
  return lines.map((l) => {
    const amt = Number(l.amount);
    const cands: MatchCandidate[] = [];
    if (!l.matchedId) {
      if (amt > 0) {
        for (const { p, who } of cps) {
          if (matchedIds.has(p.id)) continue;
          if (Math.abs(Number(p.amount) - amt) < 0.005 && dayDiff(p.paidAt, l.postedAt) <= 7) cands.push({ type: "customer_payment", id: p.id, number: p.number, date: p.paidAt, amount: Number(p.amount), who: who ?? "", days: dayDiff(p.paidAt, l.postedAt) });
        }
      } else {
        for (const { p, who } of vps) {
          if (matchedIds.has(p.id)) continue;
          if (Math.abs(Number(p.amount) + amt) < 0.005 && dayDiff(p.paidAt, l.postedAt) <= 7) cands.push({ type: "vendor_payment", id: p.id, number: p.number, date: p.paidAt, amount: Number(p.amount), who, days: dayDiff(p.paidAt, l.postedAt) });
        }
      }
      cands.sort((a, b) => a.days - b.days);
    }
    return { line: l, candidates: cands };
  });
}

export async function matchBankLine(db: DbOrTx, actor: Actor, lineId: string, matchedType: string | null, matchedId: string | null) {
  await db
    .update(bankTransactions)
    .set({ matchedType, matchedId, reconciled: !!matchedId })
    .where(and(eq(bankTransactions.id, lineId), eq(bankTransactions.orgId, actor.orgId)));
}

/** Mark a line reconciled without a payment behind it (bank fee, interest) and post it. */
export async function reconcileAsEntry(db: DbOrTx, actor: Actor, lineId: string, offsetAccountId: string, cashAccountId: string) {
  const [l] = await db.select().from(bankTransactions).where(and(eq(bankTransactions.id, lineId), eq(bankTransactions.orgId, actor.orgId)));
  if (!l) throw new PostingError("Bank line not found");
  const amt = Math.abs(Number(l.amount));
  const lines = Number(l.amount) < 0 ? [{ accountId: offsetAccountId, debit: amt, credit: 0 }, { accountId: cashAccountId, debit: 0, credit: amt }] : [{ accountId: cashAccountId, debit: amt, credit: 0 }, { accountId: offsetAccountId, debit: 0, credit: amt }];
  const id = await postJournal(db, { orgId: actor.orgId, date: l.postedAt, memo: `Bank: ${l.description}`, lines });
  await db.update(bankTransactions).set({ matchedType: "journal", matchedId: id, reconciled: true }).where(eq(bankTransactions.id, l.id));
  return id;
}

/** Auto-match every unmatched line that has exactly one candidate. */
export async function autoMatchBank(db: DbOrTx, actor: Actor) {
  const rows = await bankLinesWithCandidates(db, actor.orgId, { onlyUnmatched: true });
  let n = 0;
  const used = new Set<string>();
  for (const r of rows) {
    const c = r.candidates.filter((x) => !used.has(x.id));
    if (c.length === 1) {
      await matchBankLine(db, actor, r.line.id, c[0].type, c[0].id);
      used.add(c[0].id);
      n++;
    }
  }
  return n;
}

export async function bankSummary(db: DbOrTx, orgId: string) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      unmatched: sql<number>`sum(case when ${bankTransactions.reconciled} then 0 else 1 end)::int`,
      unmatchedAmount: sql<number>`coalesce(sum(case when ${bankTransactions.reconciled} then 0 else ${bankTransactions.amount} end), 0)`.mapWith(Number),
      lastPosted: sql<string | null>`max(${bankTransactions.postedAt})`,
    })
    .from(bankTransactions)
    .where(eq(bankTransactions.orgId, orgId));
  return row ?? { total: 0, unmatched: 0, unmatchedAmount: 0, lastPosted: null };
}

// --- Budgets ----------------------------------------------------------------

export async function upsertBudget(db: DbOrTx, actor: Actor, input: { accountId: string; year: number; month: number; amount: number }) {
  await db
    .insert(budgets)
    .values({ orgId: actor.orgId, accountId: input.accountId, year: input.year, month: input.month, amount: round4(Number(input.amount)) })
    .onConflictDoUpdate({ target: [budgets.orgId, budgets.accountId, budgets.year, budgets.month], set: { amount: round4(Number(input.amount)), updatedAt: new Date() } });
}

/** Spread a yearly amount evenly across the twelve months. */
export async function setYearlyBudget(db: DbOrTx, actor: Actor, accountId: string, year: number, yearly: number) {
  const monthly = round4(Number(yearly) / 12);
  for (let m = 1; m <= 12; m++) await upsertBudget(db, actor, { accountId, year, month: m, amount: monthly });
}

/** Budget vs actual per revenue/expense account for a year, through a month. */
export async function budgetVariance(db: DbOrTx, orgId: string, year: number, throughMonth: number) {
  const from = `${year}-01-01`;
  const to = `${year}-${String(throughMonth).padStart(2, "0")}-${new Date(year, throughMonth, 0).getDate()}`;
  const [actuals, buds, accts] = await Promise.all([
    accountBalances(db, orgId, { from, to }),
    db.select().from(budgets).where(and(eq(budgets.orgId, orgId), eq(budgets.year, year), lte(budgets.month, throughMonth))),
    db.select().from(accounts).where(and(eq(accounts.orgId, orgId), inArray(accounts.type, ["revenue", "expense"]), eq(accounts.active, true))).orderBy(asc(accounts.code)),
  ]);
  return accts.map((a) => {
    const actual = actuals.find((x) => x.id === a.id)?.balance ?? 0;
    const budget = round4(buds.filter((b) => b.accountId === a.id).reduce((s, b) => s + Number(b.amount), 0));
    return { account: a, actual: round4(actual), budget, variance: round4(actual - budget) };
  });
}

export async function budgetsForYear(db: DbOrTx, orgId: string, year: number) {
  return db.select().from(budgets).where(and(eq(budgets.orgId, orgId), eq(budgets.year, year)));
}

// --- Reports ----------------------------------------------------------------

/** Simplified cash flow: change in cash explained by net income and balance-sheet movements. */
export async function cashFlow(db: DbOrTx, orgId: string, from: string, to: string) {
  const period = await accountBalances(db, orgId, { from, to });
  const by = (subtype: string) => period.filter((r) => r.subtype === subtype).reduce((s, r) => s + r.balance, 0);
  const typeSum = (type: string) => period.filter((r) => r.type === type).reduce((s, r) => s + r.balance, 0);
  const netIncome = round4(typeSum("revenue") - typeSum("expense"));
  const arChange = round4(by("accounts_receivable"));
  const inventoryChange = round4(by("inventory") + by("wip"));
  const apChange = round4(by("accounts_payable") + by("accrued_purchases") + by("accrued_payroll") + by("sales_tax_payable"));
  const fixedAssets = round4(by("fixed_assets"));
  const equity = round4(by("owner_equity"));
  const operating = round4(netIncome - arChange - inventoryChange + apChange);
  const investing = round4(-fixedAssets);
  const financing = round4(equity);
  const cash = round4(by("cash"));
  return { netIncome, arChange, inventoryChange, apChange, operating, investing, financing, cashChange: cash, unexplained: round4(cash - (operating + investing + financing)) };
}

/** Taxable sales and tax collected per month, from issued invoices. */
export async function salesTaxReport(db: DbOrTx, orgId: string, from: string, to: string) {
  const rows = await db
    .select({ month: sql<string>`substr(${invoices.issueDate}::text, 1, 7)`, taxable: sql<number>`sum(case when ${invoices.tax} > 0 then ${invoices.subtotal} - ${invoices.freight} else 0 end)`.mapWith(Number), exempt: sql<number>`sum(case when ${invoices.tax} > 0 then 0 else ${invoices.subtotal} - ${invoices.freight} end)`.mapWith(Number), tax: sql<number>`sum(${invoices.tax})`.mapWith(Number) })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.kind, "invoice"), sql`${invoices.status} <> 'void'`, gte(invoices.issueDate, from), lte(invoices.issueDate, to)))
    .groupBy(sql`substr(${invoices.issueDate}::text, 1, 7)`)
    .orderBy(sql`substr(${invoices.issueDate}::text, 1, 7)`);
  return rows.map((r) => ({ ...r, taxable: round4(r.taxable), exempt: round4(r.exempt), tax: round4(r.tax) }));
}

/** Payments to 1099 vendors in a calendar year. */
export async function vendor1099Report(db: DbOrTx, orgId: string, year: number) {
  const rows = await db
    .select({ vendorId: vendors.id, name: vendors.name, taxId: vendors.taxId, paid: sql<number>`coalesce(sum(${vendorPayments.amount}), 0)`.mapWith(Number) })
    .from(vendorPayments)
    .innerJoin(vendors, eq(vendors.id, vendorPayments.vendorId))
    .where(and(eq(vendorPayments.orgId, orgId), eq(vendors.is1099, true), gte(vendorPayments.paidAt, `${year}-01-01`), lte(vendorPayments.paidAt, `${year}-12-31`)))
    .groupBy(vendors.id, vendors.name, vendors.taxId)
    .orderBy(desc(sql`sum(${vendorPayments.amount})`));
  return rows.map((r) => ({ ...r, paid: round4(r.paid), reportable: r.paid >= 600 }));
}

/** Things that usually need attention before a period is locked. */
export async function closeChecklist(db: DbOrTx, orgId: string, asOf: string) {
  const [bank] = await db.select({ n: sql<number>`count(*)::int` }).from(bankTransactions).where(and(eq(bankTransactions.orgId, orgId), eq(bankTransactions.reconciled, false), lte(bankTransactions.postedAt, asOf)));
  const [unbilled] = await db
    .select({ n: sql<number>`count(distinct ${purchaseOrders.id})::int`, amount: sql<number>`coalesce(sum((${purchaseOrderLines.qtyReceived} - ${purchaseOrderLines.qtyBilled}) * ${purchaseOrderLines.unitCost}), 0)`.mapWith(Number) })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.poId))
    .where(and(eq(purchaseOrderLines.orgId, orgId), sql`${purchaseOrderLines.qtyReceived} > ${purchaseOrderLines.qtyBilled}`));
  const [overdueAr] = await db.select({ n: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${invoices.total} - ${invoices.amountPaid}), 0)`.mapWith(Number) }).from(invoices).where(and(eq(invoices.orgId, orgId), eq(invoices.status, "issued"), sql`${invoices.dueDate} < ${asOf}`));
  const [overdueAp] = await db.select({ n: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${vendorBills.total} - ${vendorBills.amountPaid}), 0)`.mapWith(Number) }).from(vendorBills).where(and(eq(vendorBills.orgId, orgId), eq(vendorBills.status, "approved"), sql`${vendorBills.dueDate} < ${asOf}`));
  const [openWip] = await db.select({ n: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${workOrders.materialCost} + ${workOrders.laborCost} + ${workOrders.outsideCost} + ${workOrders.overheadCost}), 0)`.mapWith(Number) }).from(workOrders).where(and(eq(workOrders.orgId, orgId), inArray(workOrders.status, ["released", "in_progress"])));
  const [unposted] = await db.select({ n: sql<number>`count(*)::int` }).from(journalTemplates).where(and(eq(journalTemplates.orgId, orgId), eq(journalTemplates.active, true), sql`${journalTemplates.nextDate} <= ${asOf}`));
  return {
    bankUnreconciled: bank?.n ?? 0,
    receivedNotBilled: { count: unbilled?.n ?? 0, amount: round4(unbilled?.amount ?? 0) },
    overdueAr: { count: overdueAr?.n ?? 0, amount: round4(overdueAr?.amount ?? 0) },
    overdueAp: { count: overdueAp?.n ?? 0, amount: round4(overdueAp?.amount ?? 0) },
    openWip: { count: openWip?.n ?? 0, amount: round4(openWip?.amount ?? 0) },
    templatesDue: unposted?.n ?? 0,
  };
}

/** Every journal line in a range, for the accountant's export. */
export async function journalExport(db: DbOrTx, orgId: string, from: string, to: string) {
  return db
    .select({ date: journalEntries.entryDate, number: journalEntries.number, memo: journalEntries.memo, event: journalEntries.event, code: accounts.code, account: accounts.name, debit: journalLines.debit, credit: journalLines.credit, lineMemo: journalLines.memo, status: journalEntries.status })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalEntries.orgId, orgId), gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to)))
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.number), asc(accounts.code));
}

export function monthRange(year: number, month: number) {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  return { from, to: addDays(`${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}-01`, -1) };
}

export { isNull };
