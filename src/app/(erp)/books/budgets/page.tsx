import { and, asc, eq, inArray } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { Card, PageHeader, Tabs } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/fields";
import { saveBudgetAction } from "@/modules/books/actions";
import { budgetVariance } from "@/modules/books/extras";
import { fmtMoney } from "@/lib/money";
import { BOOKS_TABS } from "../tabs";

export const metadata = { title: "Budgets" };

export default async function BudgetsPage({ searchParams }: { searchParams: Promise<{ year?: string; through?: string }> }) {
  const sp = await searchParams;
  const now = new Date();
  const year = Number(sp.year) || now.getFullYear();
  const through = Math.min(12, Math.max(1, Number(sp.through) || now.getMonth() + 1));
  const ctx = await requireOrg();
  const db = await getDb();
  const [rows, accts] = await Promise.all([
    budgetVariance(db, ctx.orgId, year, through),
    db.select({ id: accounts.id, code: accounts.code, name: accounts.name, type: accounts.type }).from(accounts).where(and(eq(accounts.orgId, ctx.orgId), eq(accounts.active, true), inArray(accounts.type, ["revenue", "expense"]))).orderBy(asc(accounts.code)),
  ]);
  const rev = rows.filter((r) => r.account.type === "revenue");
  const exp = rows.filter((r) => r.account.type === "expense");
  const sum = (xs: typeof rows, k: "actual" | "budget") => xs.reduce((s, r) => s + r[k], 0);
  return (
    <>
      <PageHeader title="Budgets" description={`${year}, January through month ${through}`} />
      <Tabs tabs={BOOKS_TABS} current="/books/budgets" />
      <form method="get" action="/books/budgets" className="mb-3 flex items-end gap-2">
        <div>
          <span className="mb-1 block text-xs text-ink-2">Year</span>
          <Input name="year" type="number" defaultValue={year} className="w-24" />
        </div>
        <div>
          <span className="mb-1 block text-xs text-ink-2">Through month</span>
          <Input name="through" type="number" min="1" max="12" defaultValue={through} className="w-24" />
        </div>
        <button type="submit" className="h-9 rounded border border-line bg-white px-3 text-sm hover:bg-paper">
          Show
        </button>
      </form>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Budget vs actual" padded={false} className="lg:col-span-2">
          <table className="data">
            <thead>
              <tr>
                <th>Account</th>
                <th className="num">Budget YTD</th>
                <th className="num">Actual YTD</th>
                <th className="num">Variance</th>
                <th className="num">%</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Revenue", rev],
                ["Expenses", exp],
              ].map(([label, list]) => (
                <Row key={String(label)} label={String(label)} list={list as typeof rows} />
              ))}
              <tr className="font-semibold">
                <td>Net income</td>
                <td className="num">{fmtMoney(sum(rev, "budget") - sum(exp, "budget"))}</td>
                <td className="num">{fmtMoney(sum(rev, "actual") - sum(exp, "actual"))}</td>
                <td className="num">{fmtMoney(sum(rev, "actual") - sum(exp, "actual") - (sum(rev, "budget") - sum(exp, "budget")))}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card title="Set a yearly budget">
          <ActionForm action={saveBudgetAction} className="space-y-2">
            <input type="hidden" name="year" value={year} />
            <Select name="accountId" required defaultValue="">
              <option value="">Account</option>
              {accts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </Select>
            <Input name="yearly" type="number" step="0.01" placeholder={`Amount for ${year}`} required />
            <SubmitButton variant="secondary" className="w-full">
              Save
            </SubmitButton>
            <p className="text-xs text-ink-3">Spread evenly over the twelve months. Expenses are entered as positive amounts.</p>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

function Row({ label, list }: { label: string; list: { account: { id: string; code: string; name: string }; actual: number; budget: number; variance: number }[] }) {
  return (
    <>
      <tr>
        <td colSpan={5} className="bg-paper text-xs font-semibold uppercase text-ink-3">
          {label}
        </td>
      </tr>
      {list.map((r) => (
        <tr key={r.account.id}>
          <td>
            {r.account.code} {r.account.name}
          </td>
          <td className="num">{r.budget ? fmtMoney(r.budget) : <span className="text-ink-3">—</span>}</td>
          <td className="num">{fmtMoney(r.actual)}</td>
          <td className={`num ${r.budget && Math.abs(r.variance) > 0.005 ? (r.variance > 0 ? "text-ink" : "text-ink") : "text-ink-3"}`}>{r.budget ? fmtMoney(r.variance) : "—"}</td>
          <td className="num text-ink-3">{r.budget ? `${((r.actual / r.budget) * 100).toFixed(0)}%` : ""}</td>
        </tr>
      ))}
    </>
  );
}
