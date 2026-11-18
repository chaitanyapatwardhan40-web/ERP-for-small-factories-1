import Link from "next/link";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { balanceSheet, profitAndLoss } from "@/modules/books/service";
import { apAging, arAging } from "@/modules/shipping/service";
import { customerMargins, jobMargins, onTimeDelivery } from "@/modules/reports/service";
import { inventoryLedgerValue } from "@/modules/inventory/service";
import { Card, PageHeader, Tabs, Stat } from "@/components/ui/page";
import { fmtDate, fmtMoney, fmtQty, today } from "@/lib/money";
import { BOOKS_TABS } from "../tabs";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const t = today();
  const from = sp.from ?? `${t.slice(0, 4)}-01-01`;
  const to = sp.to ?? t;
  const [pnl, bs, ar, ap, jobs, custs, otd, inv] = await Promise.all([
    profitAndLoss(db, ctx.orgId, from, to),
    balanceSheet(db, ctx.orgId, to),
    arAging(db, ctx.orgId, to),
    apAging(db, ctx.orgId, to),
    jobMargins(db, ctx.orgId, 30),
    customerMargins(db, ctx.orgId),
    onTimeDelivery(db, ctx.orgId, 90),
    inventoryLedgerValue(db, ctx.orgId),
  ]);
  const Row = ({ r }: { r: { id: string; code: string; name: string; balance: number } }) => (
    <tr>
      <td>
        <Link href={`/books/${r.id}`} className="text-brand hover:underline">
          {r.code} {r.name}
        </Link>
      </td>
      <td className="num">{fmtMoney(r.balance)}</td>
    </tr>
  );
  return (
    <>
      <PageHeader title="Reports" />
      <Tabs tabs={BOOKS_TABS} current="/books/reports" />
      <form className="mb-4 flex items-center gap-2 text-sm">
        <span className="text-ink-3">Period</span>
        <input type="date" name="from" defaultValue={from} className="rounded border border-line bg-white px-2 py-1" />
        <span className="text-ink-3">to</span>
        <input type="date" name="to" defaultValue={to} className="rounded border border-line bg-white px-2 py-1" />
        <button className="rounded border border-line bg-white px-3 py-1">Run</button>
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Net income" value={fmtMoney(pnl.netIncome)} tone={pnl.netIncome >= 0 ? "good" : "bad"} hint={`${fmtDate(from)} – ${fmtDate(to)}`} />
        <Stat label="Cash" value={fmtMoney(bs.assets.filter((a) => a.subtype === "cash").reduce((s, a) => s + a.balance, 0))} hint={`as of ${fmtDate(to)}`} />
        <Stat label="Inventory + WIP" value={fmtMoney(inv + bs.assets.filter((a) => a.subtype === "wip").reduce((s, a) => s + a.balance, 0))} />
        <Stat label="On-time delivery, 90 d" value={otd.pct === null ? "—" : `${otd.pct.toFixed(0)}%`} hint={`${otd.onTime}/${otd.total} shipments`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Profit and loss · ${fmtDate(from)} – ${fmtDate(to)}`} padded={false}>
          <table className="data">
            <tbody>
              <tr>
                <th colSpan={2}>Revenue</th>
              </tr>
              {pnl.revenue.filter((r) => r.balance).map((r) => (
                <Row key={r.id} r={r} />
              ))}
              <tr>
                <td className="font-medium">Total revenue</td>
                <td className="num font-medium">{fmtMoney(pnl.totalRevenue)}</td>
              </tr>
              <tr>
                <th colSpan={2}>Expenses</th>
              </tr>
              {pnl.expenses.filter((r) => r.balance).map((r) => (
                <Row key={r.id} r={r} />
              ))}
              <tr>
                <td className="font-medium">Total expenses</td>
                <td className="num font-medium">{fmtMoney(pnl.totalExpense)}</td>
              </tr>
              <tr>
                <td className="font-semibold">Net income</td>
                <td className={`num font-semibold ${pnl.netIncome < 0 ? "text-bad" : ""}`}>{fmtMoney(pnl.netIncome)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card title={`Balance sheet · as of ${fmtDate(to)}`} padded={false}>
          <table className="data">
            <tbody>
              <tr>
                <th colSpan={2}>Assets</th>
              </tr>
              {bs.assets.filter((r) => r.balance).map((r) => (
                <Row key={r.id} r={r} />
              ))}
              <tr>
                <td className="font-medium">Total assets</td>
                <td className="num font-medium">{fmtMoney(bs.totalAssets)}</td>
              </tr>
              <tr>
                <th colSpan={2}>Liabilities</th>
              </tr>
              {bs.liabilities.filter((r) => r.balance).map((r) => (
                <Row key={r.id} r={r} />
              ))}
              <tr>
                <td className="font-medium">Total liabilities</td>
                <td className="num font-medium">{fmtMoney(bs.totalLiabilities)}</td>
              </tr>
              <tr>
                <th colSpan={2}>Equity</th>
              </tr>
              {bs.equity.filter((r) => r.balance).map((r) => (
                <Row key={r.id} r={r} />
              ))}
              <tr>
                <td>Current earnings</td>
                <td className="num">{fmtMoney(bs.currentEarnings)}</td>
              </tr>
              <tr>
                <td className="font-medium">Total equity</td>
                <td className="num font-medium">{fmtMoney(bs.totalEquity)}</td>
              </tr>
              <tr>
                <td className="font-semibold">Liabilities + equity</td>
                <td className={`num font-semibold ${Math.abs(bs.totalLiabilities + bs.totalEquity - bs.totalAssets) < 0.005 ? "text-good" : "text-bad"}`}>{fmtMoney(bs.totalLiabilities + bs.totalEquity)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card title="Receivables aging" padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Due</th>
                <th className="num">Open</th>
              </tr>
            </thead>
            <tbody>
              {ar.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/invoices/${r.id}`} className="text-brand hover:underline">
                      {r.number}
                    </Link>
                  </td>
                  <td>{r.customerName}</td>
                  <td className={r.dueDate < t ? "text-bad" : ""}>{fmtDate(r.dueDate)}</td>
                  <td className="num">{fmtMoney(r.open)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} className="text-right text-xs text-ink-3">
                  current {fmtMoney(ar.buckets.current)} · 1–30 {fmtMoney(ar.buckets.d1_30)} · 31–60 {fmtMoney(ar.buckets.d31_60)} · 61–90 {fmtMoney(ar.buckets.d61_90)} · 90+ {fmtMoney(ar.buckets.over90)}
                </td>
                <td className="num font-semibold">{fmtMoney(ar.buckets.total)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card title="Payables aging" padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>Bill</th>
                <th>Vendor</th>
                <th>Due</th>
                <th className="num">Open</th>
              </tr>
            </thead>
            <tbody>
              {ap.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/bills/${r.id}`} className="text-brand hover:underline">
                      {r.number}
                    </Link>
                  </td>
                  <td>{r.vendorName}</td>
                  <td className={r.dueDate < t ? "text-bad" : ""}>{fmtDate(r.dueDate)}</td>
                  <td className="num">{fmtMoney(r.open)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} className="text-right text-xs text-ink-3">
                  current {fmtMoney(ap.buckets.current)} · 1–30 {fmtMoney(ap.buckets.d1_30)} · 31–60 {fmtMoney(ap.buckets.d31_60)} · 61–90 {fmtMoney(ap.buckets.d61_90)} · 90+ {fmtMoney(ap.buckets.over90)}
                </td>
                <td className="num font-semibold">{fmtMoney(ap.buckets.total)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card title="Job margins (last 30 completed)" padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>WO</th>
                <th>Customer</th>
                <th className="num">Qty</th>
                <th className="num">Revenue</th>
                <th className="num">Cost</th>
                <th className="num">Margin</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.woId}>
                  <td>
                    <Link href={`/work-orders/${j.woId}`} className="text-brand hover:underline">
                      {j.woNumber}
                    </Link>{" "}
                    <span className="text-ink-3">{j.sku}</span>
                  </td>
                  <td>{j.customerName ?? <span className="text-ink-3">stock</span>}</td>
                  <td className="num">{fmtQty(j.qtyComplete)}</td>
                  <td className="num">{j.revenue === null ? "—" : fmtMoney(j.revenue)}</td>
                  <td className="num">{fmtMoney(j.cost)}</td>
                  <td className={`num ${j.margin !== null && j.margin < 0 ? "text-bad" : ""}`}>{j.margin === null ? "—" : `${fmtMoney(j.margin)} (${j.marginPct?.toFixed(0)}%)`}</td>
                </tr>
              ))}
              {!jobs.length ? (
                <tr>
                  <td colSpan={6} className="text-ink-3">
                    Complete a work order to see margin.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
        <Card title="Margin by customer" padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>Customer</th>
                <th className="num">Jobs</th>
                <th className="num">Revenue</th>
                <th className="num">Cost</th>
                <th className="num">Margin</th>
              </tr>
            </thead>
            <tbody>
              {custs.map((c) => (
                <tr key={c.customer}>
                  <td>{c.customer}</td>
                  <td className="num">{c.jobs}</td>
                  <td className="num">{fmtMoney(c.revenue)}</td>
                  <td className="num">{fmtMoney(c.cost)}</td>
                  <td className={`num ${c.margin < 0 ? "text-bad" : ""}`}>
                    {fmtMoney(c.margin)} ({c.marginPct.toFixed(0)}%)
                  </td>
                </tr>
              ))}
              {!custs.length ? (
                <tr>
                  <td colSpan={5} className="text-ink-3">
                    No completed customer jobs yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
