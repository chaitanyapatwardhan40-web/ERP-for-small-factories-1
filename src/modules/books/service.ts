import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import {
  accounts,
  journalEntries,
  journalLines,
  periods,
  postingRules,
  type AccountSubtype,
} from "@/lib/db/schema";
import { nextNumber } from "@/lib/numbering";
import { round4 } from "@/lib/money";
import { CHART_TEMPLATE, DEFAULT_RULES } from "./chart";

export class PostingError extends Error {}

/** Create the chart of accounts, posting rules and the current year's periods. */
export async function seedBooks(db: DbOrTx, orgId: string, year = new Date().getFullYear()) {
  const existing = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.orgId, orgId)).limit(1);
  if (existing.length) return;
  await db.insert(accounts).values(CHART_TEMPLATE.map((a) => ({ orgId, ...a })));
  await db.insert(postingRules).values(
    DEFAULT_RULES.map((r) => ({
      orgId,
      event: r.event,
      debitSubtype: r.debit,
      creditSubtype: r.credit,
      description: r.description,
    })),
  );
  const months = Array.from({ length: 12 }, (_, i) => {
    const start = new Date(Date.UTC(year, i, 1));
    const end = new Date(Date.UTC(year, i + 1, 0));
    return {
      orgId,
      name: start.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    };
  });
  await db.insert(periods).values(months);
}

async function accountBySubtype(db: DbOrTx, orgId: string, subtype: AccountSubtype) {
  const [acct] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.subtype, subtype), eq(accounts.active, true)))
    .orderBy(asc(accounts.code))
    .limit(1);
  if (!acct) throw new PostingError(`No active account with subtype "${subtype}". Add one in Books > Chart of accounts.`);
  return acct;
}

async function assertPeriodOpen(db: DbOrTx, orgId: string, date: string) {
  const [p] = await db
    .select()
    .from(periods)
    .where(and(eq(periods.orgId, orgId), lte(periods.startDate, date), gte(periods.endDate, date)))
    .limit(1);
  if (p?.locked) throw new PostingError(`Period ${p.name} is locked.`);
}

export type PostEventInput = {
  orgId: string;
  event: string;
  amount: number;
  date: string; // YYYY-MM-DD
  memo?: string;
  sourceType?: string;
  sourceId?: string;
  /** Override the rule's credit side (e.g. an expense bill's expense account). */
  debitSubtype?: AccountSubtype;
  creditSubtype?: AccountSubtype;
};

/**
 * Post one balanced two-line journal entry for a business event using the
 * org's posting rule. Called inside the same transaction as the event.
 * Zero amounts post nothing and return null.
 */
export async function postEvent(db: DbOrTx, input: PostEventInput): Promise<string | null> {
  const amount = round4(input.amount);
  if (amount === 0) return null;
  if (amount < 0) throw new PostingError(`Negative amount for ${input.event}; post the opposite event instead.`);
  const [rule] = await db
    .select()
    .from(postingRules)
    .where(and(eq(postingRules.orgId, input.orgId), eq(postingRules.event, input.event)))
    .limit(1);
  if (!rule) throw new PostingError(`No posting rule for event "${input.event}".`);
  const debitAcct = await accountBySubtype(db, input.orgId, input.debitSubtype ?? rule.debitSubtype);
  const creditAcct = await accountBySubtype(db, input.orgId, input.creditSubtype ?? rule.creditSubtype);
  await assertPeriodOpen(db, input.orgId, input.date);
  const number = await nextNumber(db, input.orgId, "journal");
  const [entry] = await db
    .insert(journalEntries)
    .values({
      orgId: input.orgId,
      number,
      entryDate: input.date,
      memo: input.memo ?? rule.description ?? input.event,
      event: input.event,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    })
    .returning();
  await db.insert(journalLines).values([
    { orgId: input.orgId, entryId: entry.id, accountId: debitAcct.id, debit: amount, credit: 0, memo: input.memo },
    { orgId: input.orgId, entryId: entry.id, accountId: creditAcct.id, debit: 0, credit: amount, memo: input.memo },
  ]);
  return entry.id;
}

export type ManualLine = { accountId: string; debit: number; credit: number; memo?: string };

/** A manual journal entry; refuses anything that does not balance. */
export async function postJournal(
  db: DbOrTx,
  input: { orgId: string; date: string; memo: string; lines: ManualLine[] },
): Promise<string> {
  const debits = round4(input.lines.reduce((s, l) => s + Number(l.debit || 0), 0));
  const credits = round4(input.lines.reduce((s, l) => s + Number(l.credit || 0), 0));
  if (debits !== credits) throw new PostingError(`Entry does not balance: debits ${debits} vs credits ${credits}.`);
  if (debits === 0) throw new PostingError("Entry has no amounts.");
  await assertPeriodOpen(db, input.orgId, input.date);
  const number = await nextNumber(db, input.orgId, "journal");
  const [entry] = await db
    .insert(journalEntries)
    .values({ orgId: input.orgId, number, entryDate: input.date, memo: input.memo, event: "manual", sourceType: "manual" })
    .returning();
  await db.insert(journalLines).values(
    input.lines
      .filter((l) => Number(l.debit || 0) !== 0 || Number(l.credit || 0) !== 0)
      .map((l) => ({
        orgId: input.orgId,
        entryId: entry.id,
        accountId: l.accountId,
        debit: round4(Number(l.debit || 0)),
        credit: round4(Number(l.credit || 0)),
        memo: l.memo,
      })),
  );
  return entry.id;
}

/** Reverse an entry with a mirror-image entry dated today (or as given). */
export async function reverseEntry(db: DbOrTx, orgId: string, entryId: string, date: string) {
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.orgId, orgId), eq(journalEntries.id, entryId)));
  if (!entry) throw new PostingError("Entry not found");
  if (entry.status === "reversed") throw new PostingError("Already reversed");
  const lines = await db.select().from(journalLines).where(eq(journalLines.entryId, entryId));
  await assertPeriodOpen(db, orgId, date);
  const number = await nextNumber(db, orgId, "journal");
  const [rev] = await db
    .insert(journalEntries)
    .values({
      orgId,
      number,
      entryDate: date,
      memo: `Reversal of ${entry.number}`,
      event: entry.event,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      reversesId: entry.id,
    })
    .returning();
  await db.insert(journalLines).values(
    lines.map((l) => ({
      orgId,
      entryId: rev.id,
      accountId: l.accountId,
      debit: Number(l.credit),
      credit: Number(l.debit),
      memo: l.memo,
    })),
  );
  await db.update(journalEntries).set({ status: "reversed" }).where(eq(journalEntries.id, entryId));
  return rev.id;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export type AccountBalance = {
  id: string;
  code: string;
  name: string;
  type: string;
  subtype: string;
  debit: number;
  credit: number;
  /** Natural balance: debit-positive for assets/expenses, credit-positive otherwise. */
  balance: number;
};

export async function accountBalances(
  db: DbOrTx,
  orgId: string,
  opts: { from?: string; to?: string } = {},
): Promise<AccountBalance[]> {
  const conds = [eq(journalEntries.orgId, orgId)];
  if (opts.from) conds.push(gte(journalEntries.entryDate, opts.from));
  if (opts.to) conds.push(lte(journalEntries.entryDate, opts.to));
  const sums = await db
    .select({
      accountId: journalLines.accountId,
      debit: sql<number>`coalesce(sum(${journalLines.debit}), 0)`.mapWith(Number),
      credit: sql<number>`coalesce(sum(${journalLines.credit}), 0)`.mapWith(Number),
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(...conds))
    .groupBy(journalLines.accountId);
  const all = await db.select().from(accounts).where(eq(accounts.orgId, orgId)).orderBy(asc(accounts.code));
  return all.map((a) => {
    const s = sums.find((x) => x.accountId === a.id);
    const debit = round4(s?.debit ?? 0);
    const credit = round4(s?.credit ?? 0);
    const natural = a.type === "asset" || a.type === "expense" ? debit - credit : credit - debit;
    return { id: a.id, code: a.code, name: a.name, type: a.type, subtype: a.subtype, debit, credit, balance: round4(natural) };
  });
}

export async function balanceOfSubtype(db: DbOrTx, orgId: string, subtype: AccountSubtype, to?: string) {
  const rows = await accountBalances(db, orgId, { to });
  return round4(rows.filter((r) => r.subtype === subtype).reduce((s, r) => s + r.balance, 0));
}

export async function profitAndLoss(db: DbOrTx, orgId: string, from: string, to: string) {
  const rows = await accountBalances(db, orgId, { from, to });
  const revenue = rows.filter((r) => r.type === "revenue");
  const expenses = rows.filter((r) => r.type === "expense");
  const totalRevenue = round4(revenue.reduce((s, r) => s + r.balance, 0));
  const totalExpense = round4(expenses.reduce((s, r) => s + r.balance, 0));
  return { revenue, expenses, totalRevenue, totalExpense, netIncome: round4(totalRevenue - totalExpense) };
}

export async function balanceSheet(db: DbOrTx, orgId: string, asOf: string) {
  const rows = await accountBalances(db, orgId, { to: asOf });
  const assets = rows.filter((r) => r.type === "asset");
  const liabilities = rows.filter((r) => r.type === "liability");
  const equity = rows.filter((r) => r.type === "equity");
  const pnl = rows.filter((r) => r.type === "revenue" || r.type === "expense");
  const currentEarnings = round4(
    pnl.reduce((s, r) => s + (r.type === "revenue" ? r.balance : -r.balance), 0),
  );
  const totalAssets = round4(assets.reduce((s, r) => s + r.balance, 0));
  const totalLiabilities = round4(liabilities.reduce((s, r) => s + r.balance, 0));
  const totalEquity = round4(equity.reduce((s, r) => s + r.balance, 0) + currentEarnings);
  return { assets, liabilities, equity, currentEarnings, totalAssets, totalLiabilities, totalEquity };
}

export async function recentEntries(db: DbOrTx, orgId: string, limit = 50) {
  return db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.orgId, orgId))
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
    .limit(limit);
}
