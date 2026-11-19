import Link from "@/components/ui/link";
import { desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { vendorBills, vendors } from "@/lib/db/schema";
import { apAging } from "@/modules/shipping/service";
import { Card, EmptyState, PageHeader, Stat, StatusBadge } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { fmtDate, fmtMoney, today } from "@/lib/money";

export const metadata = { title: "Vendor bills" };

export default async function BillsPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const [rows, aging] = await Promise.all([
    db.select({ b: vendorBills, vendorName: vendors.name }).from(vendorBills).innerJoin(vendors, eq(vendors.id, vendorBills.vendorId)).where(eq(vendorBills.orgId, ctx.orgId)).orderBy(desc(vendorBills.billDate), desc(vendorBills.number)),
    apAging(db, ctx.orgId),
  ]);
  const t = today();
  return (
    <>
      <PageHeader title="Vendor bills" actions={<LinkButton href="/bills/new">New expense bill</LinkButton>} />
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
                <th>Bill</th>
                <th>Vendor</th>
                <th>Vendor ref</th>
                <th>Date</th>
                <th>Due</th>
                <th>Status</th>
                <th className="num">Total</th>
                <th className="num">Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ b, vendorName }) => (
                <tr key={b.id}>
                  <td>
                    <Link href={`/bills/${b.id}`} className="font-medium text-brand hover:underline">
                      {b.number}
                    </Link>
                  </td>
                  <td>{vendorName}</td>
                  <td>{b.vendorRef}</td>
                  <td>{fmtDate(b.billDate)}</td>
                  <td className={b.status === "approved" && b.dueDate < t ? "font-medium text-bad" : ""}>{fmtDate(b.dueDate)}</td>
                  <td>
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="num">{fmtMoney(b.total)}</td>
                  <td className="num">{fmtMoney(Number(b.total) - Number(b.amountPaid))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState title="No bills yet" hint="Receive a PO and bill it, or record an expense bill." action={<LinkButton href="/bills/new">New expense bill</LinkButton>} />
      )}
    </>
  );
}
