import Link from "next/link";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { listPurchaseOrders } from "@/modules/purchasing/service";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { fmtDate, fmtMoney, today } from "@/lib/money";

export const metadata = { title: "Purchase orders" };

export default async function PurchasingPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const rows = await listPurchaseOrders(db, ctx.orgId);
  const t = today();
  return (
    <>
      <PageHeader
        title="Purchase orders"
        description={`${rows.filter((r) => ["sent", "confirmed", "partially_received"].includes(r.status)).length} open`}
        actions={
          <>
            <LinkButton href="/purchasing/shortages" variant="secondary">
              What to buy
            </LinkButton>
            <LinkButton href="/purchasing/new">New PO</LinkButton>
          </>
        }
      />
      {rows.length ? (
        <Card padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>PO</th>
                <th>Vendor</th>
                <th>Ordered</th>
                <th>Expected</th>
                <th>Confirmed</th>
                <th>Status</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/purchasing/${p.id}`} className="font-medium text-brand hover:underline">
                      {p.number}
                    </Link>
                    {p.workOrderId ? <span className="ml-1 text-xs text-ink-3">outside</span> : null}
                  </td>
                  <td>{p.vendorName}</td>
                  <td>{fmtDate(p.orderDate)}</td>
                  <td className={p.expectedDate && p.expectedDate < t && ["sent", "confirmed", "partially_received"].includes(p.status) ? "font-medium text-bad" : ""}>{fmtDate(p.expectedDate)}</td>
                  <td>{p.confirmedDate ? fmtDate(p.confirmedDate) : <span className="text-ink-3">—</span>}</td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="num">{fmtMoney(p.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState title="No purchase orders" hint="Start from the shortage list or raise one by hand." action={<LinkButton href="/purchasing/new">New PO</LinkButton>} />
      )}
    </>
  );
}
