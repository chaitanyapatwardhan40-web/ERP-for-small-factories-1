import Link from "@/components/ui/link";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { listOrders } from "@/modules/sales/service";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { fmtDate, fmtMoney, today } from "@/lib/money";

export const metadata = { title: "Sales orders" };

const FILTERS = [
  ["", "All"],
  ["confirmed", "Confirmed"],
  ["in_production", "In production"],
  ["partially_shipped", "Partially shipped"],
  ["shipped", "Shipped"],
  ["invoiced", "Invoiced"],
  ["draft", "Draft"],
];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; program?: string; customerId?: string }> }) {
  const sp = await searchParams;
  const { status } = sp;
  const ctx = await requireOrg();
  const db = await getDb();
  const rows = await listOrders(db, ctx.orgId, { status: status || undefined, q: sp.q, program: sp.program, customerId: sp.customerId });
  const t = today();
  return (
    <>
      <PageHeader title="Sales orders" description={`${rows.length} orders`} actions={<LinkButton href="/orders/new">New order</LinkButton>} />
      <div className="mb-3 flex flex-wrap gap-1">
        {FILTERS.map(([v, label]) => (
          <Link key={v} href={v ? `/orders?status=${v}` : "/orders"} className={`rounded-full border px-3 py-1 text-xs ${(status ?? "") === v ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-white text-ink-2"}`}>
            {label}
          </Link>
        ))}
      </div>
      <ListToolbar action="/orders" q={sp.q} exportKind="orders" params={sp} />
      {rows.length ? (
        <Card padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Customer PO</th>
                <th>Program</th>
                <th>Ordered</th>
                <th>Promised</th>
                <th>Status</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/orders/${o.id}`} className="font-medium text-brand hover:underline">
                      {o.number}
                    </Link>
                    {o.holdReason ? <span className="ml-1 text-xs text-warn">hold</span> : null}
                  </td>
                  <td>{o.customerName}</td>
                  <td>{o.customerPo}</td>
                  <td>{o.program}</td>
                  <td>{fmtDate(o.orderDate)}</td>
                  <td className={o.promisedDate && o.promisedDate < t && !["shipped", "invoiced", "closed", "cancelled"].includes(o.status) ? "font-medium text-bad" : ""}>{fmtDate(o.promisedDate)}</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="num">{fmtMoney(o.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState title="No orders" hint="Accept a quote or create an order directly." action={<LinkButton href="/orders/new">New order</LinkButton>} />
      )}
    </>
  );
}
