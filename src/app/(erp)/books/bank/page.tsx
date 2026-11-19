import { and, asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { Card, PageHeader, Stat, Tabs } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Select } from "@/components/ui/fields";
import { Button } from "@/components/ui/button";
import { autoMatchAction, importBankAction, matchBankAction, reconcileEntryAction } from "@/modules/books/actions";
import { bankLinesWithCandidates, bankSummary } from "@/modules/books/extras";
import { balanceOfSubtype } from "@/modules/books/service";
import { fmtDate, fmtMoney } from "@/lib/money";
import { BOOKS_TABS } from "../tabs";

export const metadata = { title: "Bank reconciliation" };

export default async function BankPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const [rows, summary, accts, bookCash] = await Promise.all([
    bankLinesWithCandidates(db, ctx.orgId, { onlyUnmatched: !all }),
    bankSummary(db, ctx.orgId),
    db.select({ id: accounts.id, code: accounts.code, name: accounts.name, subtype: accounts.subtype, type: accounts.type }).from(accounts).where(and(eq(accounts.orgId, ctx.orgId), eq(accounts.active, true))).orderBy(asc(accounts.code)),
    balanceOfSubtype(db, ctx.orgId, "cash"),
  ]);
  const cashAccts = accts.filter((a) => a.subtype === "cash");
  const offsetAccts = accts.filter((a) => a.type === "expense" || a.type === "revenue");
  return (
    <>
      <PageHeader title="Bank reconciliation" description="Import the statement, match each line to a payment, post the rest (fees, interest)." />
      <Tabs tabs={BOOKS_TABS} current="/books/bank" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Cash per books" value={fmtMoney(bookCash)} />
        <Stat label="Statement lines" value={summary.total} hint={summary.lastPosted ? `through ${fmtDate(summary.lastPosted)}` : "none imported"} />
        <Stat label="Unmatched" value={summary.unmatched} tone={summary.unmatched ? "warn" : "good"} hint={fmtMoney(summary.unmatchedAmount)} />
        <Stat label="Matched" value={summary.total - summary.unmatched} tone="good" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card
            title={all ? "All statement lines" : "Unmatched statement lines"}
            padded={false}
            actions={
              <div className="flex items-center gap-3 text-xs">
                <a href={all ? "/books/bank" : "/books/bank?all=1"} className="text-brand hover:underline">
                  {all ? "Show unmatched" : "Show all"}
                </a>
                <form action={autoMatchAction}>
                  <button type="submit" className="text-brand hover:underline">
                    Auto-match
                  </button>
                </form>
              </div>
            }
          >
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="num">Amount</th>
                  <th>Match</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ line, candidates }) => (
                  <tr key={line.id}>
                    <td>{fmtDate(line.postedAt)}</td>
                    <td>
                      {line.description}
                      {line.reference ? <span className="ml-1 text-xs text-ink-3">{line.reference}</span> : null}
                    </td>
                    <td className={`num ${Number(line.amount) < 0 ? "text-bad" : "text-good"}`}>{fmtMoney(line.amount)}</td>
                    <td>
                      {line.reconciled ? (
                        <form action={matchBankAction} className="flex items-center gap-2 text-xs">
                          <input type="hidden" name="lineId" value={line.id} />
                          <input type="hidden" name="match" value="" />
                          <span className="text-good">{line.matchedType === "journal" ? "posted" : "matched"}</span>
                          <button type="submit" className="text-ink-3 hover:underline">
                            undo
                          </button>
                        </form>
                      ) : candidates.length ? (
                        <form action={matchBankAction} className="flex items-center gap-1">
                          <input type="hidden" name="lineId" value={line.id} />
                          <Select name="match" defaultValue={`${candidates[0].type}:${candidates[0].id}`} className="w-64 text-xs">
                            {candidates.map((c) => (
                              <option key={c.id} value={`${c.type}:${c.id}`}>
                                {c.number} · {c.who} · {fmtDate(c.date)}
                              </option>
                            ))}
                          </Select>
                          <Button type="submit" size="sm" variant="secondary">
                            Match
                          </Button>
                        </form>
                      ) : (
                        <ActionForm action={reconcileEntryAction} className="flex items-center gap-1">
                          <input type="hidden" name="lineId" value={line.id} />
                          <input type="hidden" name="cashAccountId" value={cashAccts[0]?.id ?? ""} />
                          <Select name="offsetAccountId" defaultValue="" className="w-56 text-xs" required>
                            <option value="">Post to…</option>
                            {offsetAccts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} {a.name}
                              </option>
                            ))}
                          </Select>
                          <SubmitButton size="sm" variant="secondary">
                            Post
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={4} className="text-ink-3">
                      {all ? "No statement lines imported yet." : "Everything is matched."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
        </div>
        <Card title="Import statement">
          <ActionForm action={importBankAction} className="space-y-3">
            <div>
              <span className="mb-1 block text-xs font-medium text-ink-2">Bank account</span>
              <Select name="accountId" defaultValue={cashAccts[0]?.id ?? ""}>
                {cashAccts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-ink-2">CSV from the bank</span>
              <input name="file" type="file" accept=".csv,.txt" className="text-sm" required />
            </div>
            <SubmitButton className="w-full">Import</SubmitButton>
            <p className="text-xs text-ink-3">Columns recognised: date, description, amount (or separate debit / credit), reference. Lines already imported are skipped. Lines with one matching payment are matched automatically.</p>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
