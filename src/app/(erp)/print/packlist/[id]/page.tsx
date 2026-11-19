import { notFound } from "next/navigation";
import { uuidOr404 } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { customers, items, orgs, salesOrderLines, salesOrders, shipmentLines, shipments } from "@/lib/db/schema";
import { PrintDoc } from "@/components/print";
import { fmtDate, fmtQty } from "@/lib/money";

export default async function PrintPackListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [row] = await db.select({ s: shipments, order: salesOrders, customer: customers }).from(shipments).innerJoin(salesOrders, eq(salesOrders.id, shipments.orderId)).innerJoin(customers, eq(customers.id, shipments.customerId)).where(and(eq(shipments.id, id), eq(shipments.orgId, ctx.orgId)));
  if (!row) notFound();
  const [org] = await db.select().from(orgs).where(eq(orgs.id, ctx.orgId));
  const lines = await db.select({ l: shipmentLines, sku: items.sku, description: salesOrderLines.description, ordered: salesOrderLines.qty }).from(shipmentLines).innerJoin(items, eq(items.id, shipmentLines.itemId)).innerJoin(salesOrderLines, eq(salesOrderLines.id, shipmentLines.orderLineId)).where(eq(shipmentLines.shipmentId, row.s.id));
  const a = row.s.shipTo ?? row.customer.shippingAddress ?? row.customer.billingAddress;
  return (
    <PrintDoc
      title="Packing list"
      number={row.s.number}
      org={org}
      meta={[
        ["Ship date", row.s.shippedAt ? fmtDate(row.s.shippedAt) : "—"],
        ["Order", row.order.number],
        ["Your PO", row.order.customerPo ?? "—"],
        ["Carrier", row.s.carrier ?? "—"],
        ["Tracking", row.s.tracking ?? "—"],
        ["Packages", String(row.s.packages)],
        ["Weight", Number(row.s.weight) ? `${Number(row.s.weight)} lb` : "—"],
      ]}
      party={{ label: "Ship to", name: row.customer.name, lines: [a?.line1, a?.line2, [a?.city, a?.state, a?.postalCode].filter(Boolean).join(" ")].filter(Boolean) as string[] }}
      notes={row.s.notes}
    >
      <table className="data">
        <thead>
          <tr>
            <th>Part</th>
            <th>Description</th>
            <th className="num">Ordered</th>
            <th className="num">Shipped</th>
            <th>Lot</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.l.id}>
              <td className="font-mono text-xs">{l.sku}</td>
              <td>{l.description}</td>
              <td className="num">{fmtQty(l.ordered)}</td>
              <td className="num">{fmtQty(l.l.qty)}</td>
              <td>{l.l.lotNumber}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PrintDoc>
  );
}
