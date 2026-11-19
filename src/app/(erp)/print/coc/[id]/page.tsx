import { notFound } from "next/navigation";
import { uuidOr404 } from "@/lib/ids";
import { and, eq, inArray } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { customers, inspections, items, orgs, salesOrderLines, salesOrders, shipmentLines, shipments, workOrders } from "@/lib/db/schema";
import { PrintDoc } from "@/components/print";
import { formatAddress } from "@/lib/forms";
import { fmtDate, fmtQty } from "@/lib/money";

/** Certificate of conformance for a shipment: items, lots, revisions and the final inspections behind them. */
export default async function PrintCocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [row] = await db.select({ s: shipments, order: salesOrders, customer: customers }).from(shipments).innerJoin(salesOrders, eq(salesOrders.id, shipments.orderId)).innerJoin(customers, eq(customers.id, shipments.customerId)).where(and(eq(shipments.id, id), eq(shipments.orgId, ctx.orgId)));
  if (!row) notFound();
  const [org] = await db.select().from(orgs).where(eq(orgs.id, ctx.orgId));
  const lines = await db
    .select({ l: shipmentLines, sku: items.sku, name: items.name, revision: items.revision, drawing: items.drawingNumber, orderLineId: salesOrderLines.id })
    .from(shipmentLines)
    .innerJoin(items, eq(items.id, shipmentLines.itemId))
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, shipmentLines.orderLineId))
    .where(eq(shipmentLines.shipmentId, row.s.id));
  const wos = lines.length ? await db.select().from(workOrders).where(inArray(workOrders.salesOrderLineId, lines.map((l) => l.orderLineId))) : [];
  const finals = wos.length ? await db.select().from(inspections).where(and(eq(inspections.orgId, ctx.orgId), eq(inspections.stage, "final"), inArray(inspections.refId, wos.map((w) => w.id)))) : [];
  const a = row.s.shipTo ?? row.customer.shippingAddress;
  return (
    <PrintDoc
      title="Certificate of conformance"
      number={row.s.number}
      org={org}
      meta={[
        ["Date", row.s.shippedAt ? fmtDate(row.s.shippedAt) : fmtDate(new Date())],
        ["Order", row.order.number],
        ["Your PO", row.order.customerPo ?? "—"],
      ]}
      party={{ label: "Customer", name: row.customer.name, lines: formatAddress(a) }}
      footer={
        <div className="mt-8 grid grid-cols-2 gap-8">
          <div>
            <div className="border-t border-ink pt-1">Authorized signature</div>
          </div>
          <div>
            <div className="border-t border-ink pt-1">Date</div>
          </div>
        </div>
      }
    >
      <p className="mb-4">
        {org?.settings.company?.legalName || org?.name} certifies that the items listed below were manufactured, inspected and tested in accordance with the purchase order requirements, applicable drawings and specifications, and conform to them. Records of material, process and inspection are on file and available on request.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>Part</th>
            <th>Description</th>
            <th>Rev</th>
            <th>Drawing</th>
            <th className="num">Qty</th>
            <th>Lot / serial</th>
            <th>Work order</th>
            <th>Final inspection</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const wo = wos.find((w) => w.salesOrderLineId === l.orderLineId);
            const insp = wo ? finals.find((f) => f.refId === wo.id) : undefined;
            return (
              <tr key={l.l.id}>
                <td className="font-mono text-xs">{l.sku}</td>
                <td>{l.name}</td>
                <td>{l.revision}</td>
                <td>{l.drawing ?? "—"}</td>
                <td className="num">{fmtQty(l.l.qty)}</td>
                <td>{l.l.lotNumber ?? "—"}</td>
                <td className="font-mono text-xs">{wo?.number ?? "stock"}</td>
                <td>{insp ? `${insp.result} · ${fmtDate(insp.inspectedAt)}` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </PrintDoc>
  );
}
