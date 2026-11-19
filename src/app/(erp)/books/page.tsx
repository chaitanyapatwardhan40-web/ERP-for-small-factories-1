import Link from "@/components/ui/link";
import { and, asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { accountBalances, recentEntries } from "@/modules/books/service";
import { Card, PageHeader, Tabs, StatusBadge } from "@/components/ui/page";
import { JournalForm } from "@/components/forms/journal-form";
import { fmtDate, fmtMoney, today } from "@/lib/money";
import { BOOKS_TABS } from "./tabs";

export const metadata = { title: "Ledger" };

export default async function BooksPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const [entries, balances, accts] = await Promise.all([
    recentEntries(db, ctx.orgId, 100),
    accountBalances(db, ctx.orgId),
    db.select().from(accounts).where(and(eq(accounts.orgId, ctx.orgId), eq(accounts.active, true))).orderBy(asc(accounts.code)),
  ]);
  const debits = balances.reduce((s, b) => s + b.debit, 0);
  const credits = balances.reduce((s, b) => s + b.credit, 0);
  return (
    <>
      <PageHeader title="General ledger" />
      <Tabs tabs={BOOKS_TABS} current="/books" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Trial balance" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Account</th>
                  <th>Type</th>
                  <th className="num">Debits</th>
                  <th className="num">Credits</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {balances
                  .filter((b) => b.debit || b.credit)
                  .map((b) => (
                    <tr key={b.id}>
                      <td className="font-mono text-xs">{b.code}</td>
                      <td>
                        <Link href={`/books/${b.id}`} className="text-brand hover:underline">
                          {b.name}
                        </Link>
                      </td>
                      <td className="text-ink-3">{b.type}</td>
                      <td className="num">{fmtMoney(b.debit)}</td>
                      <td className="num">{fmtMoney(b.credit)}</td>
                      <td className="num font-medium">{fmtMoney(b.balance)}</td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="text-right font-medium">
                    Totals {Math.abs(debits - credits) < 0.005 ? <span className="text-good">· in balance</span> : <span className="text-bad">· OUT OF BALANCE</span>}
                  </td>
                  <td className="num font-semibold">{fmtMoney(debits)}</td>
                  <td className="num font-semibold">{fmtMoney(credits)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </Card>
          <Card title="Journal" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>Entry</th>
                  <th>Date</th>
                  <th>Event</th>
                  <th>Memo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link href={`/books/${e.id}?entry=1`} className="font-mono text-xs text-brand hover:underline">
                        {e.number}
                      </Link>
                    </td>
                    <td>{fmtDate(e.entryDate)}</td>
                    <td className="text-xs text-ink-3">{e.event}</td>
                    <td>{e.memo}</td>
                    <td>{e.status === "reversed" ? <StatusBadge status="void" /> : null}</td>
                  </tr>
                ))}
                {!entries.length ? (
                  <tr>
                    <td colSpan={5} className="text-ink-3">
                      Nothing posted yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
        </div>
        <div>
          <Card title="Manual journal entry">
            <JournalForm accounts={accts.map((a) => ({ id: a.id, code: a.code, name: a.name }))} defaultDate={today()} />
          </Card>
        </div>
      </div>
    </>
  );
}
