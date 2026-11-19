import Link from "@/components/ui/link";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { customers, invoices } from "@/lib/db/schema";
import { arAging } from "@/modules/shipping/service";
import { Card, EmptyState, PageHeader, Stat, StatusBadge } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { fmtDate, fmtMoney, today } from "@/lib/money";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; paid?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const [rows, aging] = await Promise.all([
    db
      .select({ i: invoices, customerName: customers.name })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(
        and(
          eq(invoices.orgId, ctx.orgId),
          sp.status ? eq(invoices.status, sp.status as "issued" | "paid" | "void" | "draft") : undefined,
          sp.q ? or(ilike(invoices.number, `%${sp.q}%`), ilike(customers.name, `%${sp.q}%`)) : undefined,
        ),
      )
      .orderBy(desc(invoices.issueDate), desc(invoices.number)),
    arAging(db, ctx.orgId),
  ]);
  const t = today();
  return (
    <>
      <PageHeader
        title="Invoices"
        description={sp.paid ? `Payment ${sp.paid} recorded.` : undefined}
        actions={
          <>
            <LinkButton href="/books/reports#aging" variant="secondary">
              Aging report
            </LinkButton>
            <LinkButton href="/invoices/receive">Receive payment</LinkButton>
          </>
        }
      />
      <ListToolbar action="/invoices" q={sp.q} exportKind="invoices" params={sp} filters={[{ name: "status", value: sp.status, options: [{ value: "", label: "All statuses" }, { value: "issued", label: "open" }, { value: "paid", label: "paid" }, { value: "void", label: "void" }] }]} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Open" value={fmtMoney(aging.buckets.total)} />
        <Stat label="Current" value={fmtMoney(aging.buckets.current)} tone="good" />
        <Stat label="1–30" value={fmtMoney(aging.buckets.d1_30)} />
        <Stat label="31–60" value={fmtMoney(aging.buckets.d31_60)} tone={aging.buckets.d31_60 ? "warn" : undefined} />
        <Stat label="61–90" value={fmtMoney(aging.buckets.d61_90)} tone={aging.buckets.d61_90 ? "warn" : undefined} />
        <Stat label="Over 90" value={fmtMoney(aging.buckets.over90)} tone={aging.buckets.over90 ? "bad" : undefined} />
      </div>
      {rows.length ? (
        <Card padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Issued</th>
                <th>Due</th>
                <th>Status</th>
                <th className="num">Total</th>
                <th className="num">Paid</th>
                <th className="num">Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ i, customerName }) => (
                <tr key={i.id}>
                  <td>
                    <Link href={`/invoices/${i.id}`} className="font-medium text-brand hover:underline">
                      {i.number}
                    </Link>
                  </td>
                  <td>{customerName}</td>
                  <td>{fmtDate(i.issueDate)}</td>
                  <td className={i.status === "issued" && i.dueDate < t ? "font-medium text-bad" : ""}>{fmtDate(i.dueDate)}</td>
                  <td>
                    <StatusBadge status={i.status} />
                  </td>
                  <td className="num">{fmtMoney(i.total)}</td>
                  <td className="num">{fmtMoney(i.amountPaid)}</td>
                  <td className="num">{fmtMoney(Number(i.total) - Number(i.amountPaid))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState title="No invoices yet" hint="Ship an order and invoice the shipment." />
      )}
    </>
  );
}
