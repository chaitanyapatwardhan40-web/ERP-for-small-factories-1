import Link from "@/components/ui/link";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { listPurchaseOrders, poTotal } from "@/modules/purchasing/service";
import { pickVendors } from "@/lib/pick";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { fmtDate, fmtMoney, today } from "@/lib/money";

export const metadata = { title: "Purchase orders" };

const STATUSES = ["open", "draft", "sent", "confirmed", "partially_received", "received", "closed", "cancelled"];

export default async function PurchasingPage({ searchParams }: { searchParams: Promise<{ status?: string; vendorId?: string; q?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const [rows, vendorList] = await Promise.all([listPurchaseOrders(db, ctx.orgId, sp), pickVendors(db, ctx.orgId)]);
  const t = today();
  const openCount = rows.filter((r) => ["sent", "confirmed", "partially_received"].includes(r.status)).length;
  return (
    <>
      <PageHeader
        title="Purchase orders"
        description={`${openCount} open · ${fmtMoney(rows.filter((r) => ["sent", "confirmed", "partially_received"].includes(r.status)).reduce((s, r) => s + poTotal(r), 0))} on order`}
        actions={
          <>
            <LinkButton href="/purchasing/receipts" variant="secondary">
              Receiving log
            </LinkButton>
            <LinkButton href="/purchasing/shortages" variant="secondary">
              What to buy
            </LinkButton>
            <LinkButton href="/purchasing/new">New PO</LinkButton>
          </>
        }
      />
      <ListToolbar
        action="/purchasing"
        q={sp.q}
        exportKind="purchase-orders"
        params={sp}
        filters={[
          { name: "status", value: sp.status, options: [{ value: "", label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: s.replaceAll("_", " ") }))] },
          { name: "vendorId", value: sp.vendorId, options: [{ value: "", label: "All vendors" }, ...vendorList.map((v) => ({ value: v.id, label: v.name }))] },
        ]}
      />
      {rows.length ? (
        <Card padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>PO</th>
                <th>Vendor</th>
                <th>Vendor ref</th>
                <th>Ordered</th>
                <th>Expected</th>
                <th>Confirmed</th>
                <th>Status</th>
                <th className="num">Total</th>
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
                  <td className="text-ink-3">{p.vendorRef}</td>
                  <td>{fmtDate(p.orderDate)}</td>
                  <td className={p.expectedDate && p.expectedDate < t && ["sent", "confirmed", "partially_received"].includes(p.status) ? "font-medium text-bad" : ""}>{fmtDate(p.expectedDate)}</td>
                  <td>{p.confirmedDate ? fmtDate(p.confirmedDate) : <span className="text-ink-3">—</span>}</td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="num">{fmtMoney(poTotal(p))}</td>
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
