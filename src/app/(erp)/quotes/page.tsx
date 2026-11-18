import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { customers, quotes } from "@/lib/db/schema";
import { Card, EmptyState, PageHeader, StatusBadge, Stat } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { fmtDate, fmtMoney } from "@/lib/money";

export const metadata = { title: "Quotes" };

export default async function QuotesPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const rows = await db
    .select({ q: quotes, customerName: customers.name })
    .from(quotes)
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .where(eq(quotes.orgId, ctx.orgId))
    .orderBy(desc(quotes.quoteDate), desc(quotes.number));
  const open = rows.filter((r) => r.q.status === "draft" || r.q.status === "sent");
  const won = rows.filter((r) => r.q.status === "accepted");
  const decided = rows.filter((r) => ["accepted", "lost", "expired"].includes(r.q.status));
  const winRate = decided.length ? Math.round((won.length / decided.length) * 100) : null;
  return (
    <>
      <PageHeader title="Quotes" actions={<LinkButton href="/quotes/new">New quote</LinkButton>} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Open quotes" value={open.length} hint={fmtMoney(open.reduce((s, r) => s + Number(r.q.subtotal), 0))} />
        <Stat label="Won" value={won.length} hint={fmtMoney(won.reduce((s, r) => s + Number(r.q.subtotal), 0))} tone="good" />
        <Stat label="Win rate" value={winRate === null ? "—" : `${winRate}%`} hint={`${decided.length} decided`} />
      </div>
      {rows.length ? (
        <Card padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>Quote</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Valid until</th>
                <th>RFQ</th>
                <th>Status</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ q, customerName }) => (
                <tr key={q.id}>
                  <td>
                    <Link href={`/quotes/${q.id}`} className="font-medium text-brand hover:underline">
                      {q.number}
                    </Link>
                  </td>
                  <td>{customerName}</td>
                  <td>{fmtDate(q.quoteDate)}</td>
                  <td>{fmtDate(q.validUntil)}</td>
                  <td>{q.customerRfq}</td>
                  <td>
                    <StatusBadge status={q.status} />
                  </td>
                  <td className="num">{fmtMoney(q.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState title="No quotes yet" hint="Build a quote from an item's BOM and routing, or price a custom line." action={<LinkButton href="/quotes/new">New quote</LinkButton>} />
      )}
    </>
  );
}
