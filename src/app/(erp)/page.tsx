import Link from "@/components/ui/link";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { todaySummary } from "@/modules/reports/service";
import { latePoLines } from "@/modules/purchasing/service";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { activities } from "@/lib/db/schema";
import { completeActivityAction } from "@/modules/parties/actions";
import { Card, PageHeader, Stat, StatusBadge, EmptyState } from "@/components/ui/page";
import { addDays, fmtDate, fmtDateTime, fmtMoney, fmtQty } from "@/lib/money";

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const s = await todaySummary(db, ctx.orgId);
  const [latePos, followUps] = await Promise.all([
    latePoLines(db, ctx.orgId, s.date),
    db
      .select({
        a: activities,
        party: sql<string>`coalesce((select name from customers c where c.id = ${activities.partyId}), (select name from vendors v where v.id = ${activities.partyId}), (select company from leads l where l.id = ${activities.partyId}))`,
      })
      .from(activities)
      .where(and(eq(activities.orgId, ctx.orgId), eq(activities.done, false), lte(activities.dueAt, new Date(`${addDays(s.date, 1)}T00:00:00`))))
      .orderBy(asc(activities.dueAt))
      .limit(15),
  ]);
  return (
    <>
      <PageHeader
        title="Today"
        description={`${ctx.session.org!.name} · ${fmtDate(s.date)}`}
        actions={
          <Link href="/walkthrough" className="text-sm text-brand hover:underline">
            New here? Follow one job from quote to cash →
          </Link>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Late orders" value={s.late.length} tone={s.late.length ? "bad" : "good"} hint={`${s.dueThisWeek.length} due this week`} />
        <Stat label="Open backlog" value={fmtMoney(s.backlog)} hint={`${s.openOrders.length} open orders`} />
        <Stat label="Shortages" value={s.shortages.length} tone={s.shortages.length ? "warn" : undefined} hint="items to buy now" />
        <Stat label="On-time delivery" value={s.otd.pct === null ? "—" : `${s.otd.pct.toFixed(0)}%`} hint={`${s.otd.onTime}/${s.otd.total} shipments, 30 days`} tone={s.otd.pct !== null && s.otd.pct < 90 ? "warn" : undefined} />
        <Stat label="Cash" value={fmtMoney(s.cash)} hint="per the ledger" />
        <Stat label="Receivables" value={fmtMoney(s.arOpen)} hint={s.arOverdue ? `${fmtMoney(s.arOverdue)} overdue` : "nothing overdue"} tone={s.arOverdue ? "warn" : undefined} />
        <Stat label="Payables" value={fmtMoney(s.apOpen)} hint={`${fmtMoney(s.apDueWeek)} due within 7 days`} />
        <Stat label="Inventory + WIP" value={fmtMoney(s.inventoryValue + s.wip)} hint={`${fmtMoney(s.wip)} in WIP`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Orders by promise date" actions={<Link href="/orders" className="text-xs text-brand hover:underline">All orders</Link>} padded={false}>
          {s.openOrders.length ? (
            <table className="data">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Promised</th>
                  <th>Status</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {s.openOrders.slice(0, 12).map((o) => {
                  const isLate = o.promisedDate && o.promisedDate < s.date;
                  return (
                    <tr key={o.id}>
                      <td>
                        <Link href={`/orders/${o.id}`} className="font-medium text-brand hover:underline">
                          {o.number}
                        </Link>
                      </td>
                      <td>{o.customerName}</td>
                      <td className={isLate ? "font-medium text-bad" : ""}>{fmtDate(o.promisedDate)}</td>
                      <td>
                        <StatusBadge status={o.status} />
                      </td>
                      <td className="num">{fmtMoney(o.subtotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-4">
              <EmptyState title="No open orders" hint="Confirm a quote or create a sales order to see it here." />
            </div>
          )}
        </Card>
        <Card title="Work orders by due date" actions={<Link href="/schedule" className="text-xs text-brand hover:underline">Schedule board</Link>} padded={false}>
          {s.openWos.length ? (
            <table className="data">
              <thead>
                <tr>
                  <th>WO</th>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th>Due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {s.openWos.slice(0, 12).map((w) => (
                  <tr key={w.id}>
                    <td>
                      <Link href={`/work-orders/${w.id}`} className="font-medium text-brand hover:underline">
                        {w.number}
                      </Link>
                    </td>
                    <td>{w.sku}</td>
                    <td className="num">{fmtQty(w.qty)}</td>
                    <td className={w.dueDate && w.dueDate < s.date ? "font-medium text-bad" : ""}>{fmtDate(w.dueDate)}</td>
                    <td>
                      <StatusBadge status={w.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4">
              <EmptyState title="Nothing on the floor" hint={`${s.clockedIn} people clocked in.`} />
            </div>
          )}
        </Card>
        <Card title="What to buy" actions={<Link href="/purchasing/shortages" className="text-xs text-brand hover:underline">Full list</Link>} padded={false}>
          {s.shortages.length ? (
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">On hand</th>
                  <th className="num">Demand</th>
                  <th className="num">On order</th>
                  <th className="num">Buy</th>
                </tr>
              </thead>
              <tbody>
                {s.shortages.slice(0, 8).map((r) => (
                  <tr key={r.itemId}>
                    <td>
                      <Link href={`/items/${r.itemId}`} className="font-medium text-brand hover:underline">
                        {r.sku}
                      </Link>{" "}
                      <span className="text-ink-3">{r.name}</span>
                    </td>
                    <td className="num">{fmtQty(r.onHand)}</td>
                    <td className="num">{fmtQty(r.demand)}</td>
                    <td className="num">{fmtQty(r.onOrder)}</td>
                    <td className="num font-medium">{fmtQty(r.suggestedQty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4">
              <EmptyState title="Stock covers demand" hint="Reorder points and open work orders are all covered." />
            </div>
          )}
        </Card>
        <Card title="Late orders" padded={false}>
          {s.late.length ? (
            <table className="data">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Promised</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {s.late.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/orders/${o.id}`} className="font-medium text-brand hover:underline">
                        {o.number}
                      </Link>
                    </td>
                    <td>{o.customerName}</td>
                    <td className="text-bad">{fmtDate(o.promisedDate)}</td>
                    <td className="num">{fmtMoney(o.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4">
              <EmptyState title="Nothing late" hint="Every open order is still inside its promise date." />
            </div>
          )}
        </Card>
        <Card title="Late from vendors" padded={false}>
          {latePos.length ? (
            <table className="data">
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Vendor</th>
                  <th>Item</th>
                  <th className="num">Open</th>
                  <th>Need by</th>
                </tr>
              </thead>
              <tbody>
                {latePos.slice(0, 10).map(({ po, line, vendorName, sku }) => (
                  <tr key={line.id}>
                    <td>
                      <Link href={`/purchasing/${po.id}`} className="font-medium text-brand hover:underline">
                        {po.number}
                      </Link>
                    </td>
                    <td>{vendorName}</td>
                    <td>{sku ?? line.description}</td>
                    <td className="num">{fmtQty(Number(line.qty) - Number(line.qtyReceived) - Number(line.qtyCancelled))}</td>
                    <td className="text-bad">{fmtDate(line.expectedDate) || "no date"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4">
              <EmptyState title="No late purchase orders" hint="Every open PO line is inside its expected date." />
            </div>
          )}
        </Card>
        <Card title="Follow-ups due" padded={false}>
          {followUps.length ? (
            <table className="data">
              <tbody>
                {followUps.map(({ a, party }) => (
                  <tr key={a.id}>
                    <td className="text-xs text-ink-3">{fmtDateTime(a.dueAt)}</td>
                    <td>
                      <Link href={a.partyType === "customer" ? `/customers/${a.partyId}` : a.partyType === "vendor" ? `/vendors/${a.partyId}` : `/crm/${a.partyId}`} className="font-medium text-brand hover:underline">
                        {party}
                      </Link>
                      <div className="text-xs">{a.summary}</div>
                    </td>
                    <td className="text-right">
                      <form action={completeActivityAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="returnTo" value="/" />
                        <button type="submit" className="text-xs text-brand hover:underline">
                          Done
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4">
              <EmptyState title="No follow-ups due" hint="Log a note with a date on a customer, vendor or lead to see it here." />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
