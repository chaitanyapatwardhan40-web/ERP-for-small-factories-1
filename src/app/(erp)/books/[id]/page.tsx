import Link from "@/components/ui/link";
import { uuidOr404 } from "@/lib/ids";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { accounts, journalEntries, journalLines } from "@/lib/db/schema";
import { Card, PageHeader, StatusBadge } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { reverseEntryAction } from "@/modules/books/actions";
import { fmtDate, fmtMoney } from "@/lib/money";

/** /books/[id] shows an account's activity, or one journal entry with ?entry=1. */
export default async function BookDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ entry?: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const { entry } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();

  if (entry) {
    const [je] = await db.select().from(journalEntries).where(and(eq(journalEntries.id, id), eq(journalEntries.orgId, ctx.orgId)));
    if (!je) notFound();
    const lines = await db.select({ l: journalLines, code: accounts.code, name: accounts.name }).from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId)).where(eq(journalLines.entryId, je.id));
    return (
      <>
        <PageHeader
          title={je.number}
          description={
            <span className="flex items-center gap-2">
              <StatusBadge status={je.status === "reversed" ? "void" : "posted"} />
              <span>
                {fmtDate(je.entryDate)} · {je.event} · {je.memo}
              </span>
            </span>
          }
          crumbs={[{ href: "/books", label: "Ledger" }]}
          actions={
            je.status === "posted" ? (
              <form action={reverseEntryAction}>
                <input type="hidden" name="id" value={je.id} />
                <Button type="submit" variant="danger">
                  Reverse
                </Button>
              </form>
            ) : null
          }
        />
        <Card padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>Account</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
                <th>Memo</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(({ l, code, name }) => (
                <tr key={l.id}>
                  <td>
                    <Link href={`/books/${l.accountId}`} className="text-brand hover:underline">
                      {code} {name}
                    </Link>
                  </td>
                  <td className="num">{Number(l.debit) ? fmtMoney(l.debit) : ""}</td>
                  <td className="num">{Number(l.credit) ? fmtMoney(l.credit) : ""}</td>
                  <td>{l.memo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </>
    );
  }

  const [acct] = await db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.orgId, ctx.orgId)));
  if (!acct) notFound();
  const rows = await db
    .select({ l: journalLines, je: journalEntries })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(eq(journalLines.accountId, acct.id))
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
    .limit(300);
  const natural = acct.type === "asset" || acct.type === "expense";
  const delta = (l: { debit: number; credit: number }) => (natural ? Number(l.debit) - Number(l.credit) : Number(l.credit) - Number(l.debit));
  const total = rows.reduce((s, r) => s + delta(r.l), 0);
  // Running balance per row, newest first: the balance after that row posted.
  const balances: number[] = [];
  let run = total;
  for (const r of rows) {
    balances.push(run);
    run -= delta(r.l);
  }
  return (
    <>
      <PageHeader title={`${acct.code} ${acct.name}`} description={`${acct.type} · ${acct.subtype.replaceAll("_", " ")} · balance ${fmtMoney(total)}`} crumbs={[{ href: "/books", label: "Ledger" }]} />
      <Card padded={false}>
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>Entry</th>
              <th>Memo</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ l, je }, i) => {
              const bal = balances[i];
              return (
                <tr key={l.id}>
                  <td>{fmtDate(je.entryDate)}</td>
                  <td>
                    <Link href={`/books/${je.id}?entry=1`} className="font-mono text-xs text-brand hover:underline">
                      {je.number}
                    </Link>
                  </td>
                  <td>{l.memo ?? je.memo}</td>
                  <td className="num">{Number(l.debit) ? fmtMoney(l.debit) : ""}</td>
                  <td className="num">{Number(l.credit) ? fmtMoney(l.credit) : ""}</td>
                  <td className="num">{fmtMoney(bal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
