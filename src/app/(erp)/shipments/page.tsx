import Link from "next/link";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { listShipments } from "@/modules/shipping/service";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui/page";
import { fmtDateTime } from "@/lib/money";

export const metadata = { title: "Shipments" };

export default async function ShipmentsPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const rows = await listShipments(db, ctx.orgId);
  return (
    <>
      <PageHeader title="Shipments" />
      {rows.length ? (
        <Card padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>Shipment</th>
                <th>Order</th>
                <th>Customer</th>
                <th>Shipped</th>
                <th>Carrier</th>
                <th>Tracking</th>
                <th>Status</th>
                <th>Invoice</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/shipments/${s.id}`} className="font-medium text-brand hover:underline">
                      {s.number}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/orders/${s.orderId}`} className="text-brand hover:underline">
                      {s.orderNumber}
                    </Link>
                  </td>
                  <td>{s.customerName}</td>
                  <td>{s.shippedAt ? fmtDateTime(s.shippedAt) : "—"}</td>
                  <td>{s.carrier}</td>
                  <td className="font-mono text-xs">{s.tracking}</td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td>{s.invoiceId ? <Link href={`/invoices/${s.invoiceId}`} className="text-brand hover:underline">invoiced</Link> : s.status === "shipped" ? <span className="text-warn">not yet</span> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState title="No shipments yet" hint="Open a confirmed order and pack a shipment." />
      )}
    </>
  );
}
