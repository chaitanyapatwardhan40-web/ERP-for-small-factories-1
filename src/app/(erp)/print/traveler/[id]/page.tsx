import { notFound } from "next/navigation";
import { uuidOr404 } from "@/lib/ids";
import { and, asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { attachments, items, orgs, salesOrderLines, salesOrders, workCenters, workOrderMaterials, workOrderOperations, workOrders } from "@/lib/db/schema";
import { PrintDoc } from "@/components/print";
import { fmtDate, fmtQty } from "@/lib/money";

/** The shop traveler: what to make, from what, in which steps, with sign-offs. */
export default async function PrintTravelerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [row] = await db.select({ wo: workOrders, item: items }).from(workOrders).innerJoin(items, eq(items.id, workOrders.itemId)).where(and(eq(workOrders.id, id), eq(workOrders.orgId, ctx.orgId)));
  if (!row) notFound();
  const { wo, item } = row;
  const [org] = await db.select().from(orgs).where(eq(orgs.id, ctx.orgId));
  const [ops, mats, drawings, so] = await Promise.all([
    db.select({ op: workOrderOperations, wc: workCenters.name }).from(workOrderOperations).leftJoin(workCenters, eq(workCenters.id, workOrderOperations.workCenterId)).where(eq(workOrderOperations.workOrderId, wo.id)).orderBy(asc(workOrderOperations.seq)),
    db.select({ m: workOrderMaterials, sku: items.sku, name: items.name }).from(workOrderMaterials).innerJoin(items, eq(items.id, workOrderMaterials.itemId)).where(eq(workOrderMaterials.workOrderId, wo.id)),
    db.select().from(attachments).where(and(eq(attachments.entityType, "item"), eq(attachments.entityId, item.id), eq(attachments.current, true))),
    wo.salesOrderLineId ? db.select({ o: salesOrders }).from(salesOrderLines).innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId)).where(eq(salesOrderLines.id, wo.salesOrderLineId)).then((r) => r[0]?.o) : Promise.resolve(undefined),
  ]);
  return (
    <PrintDoc
      title="Traveler"
      number={wo.number}
      org={org}
      meta={[
        ["Part", `${item.sku} rev ${item.revision}`],
        ["Drawing", item.drawingNumber ?? drawings[0]?.filename ?? "—"],
        ["Quantity", `${fmtQty(wo.qty)} ${item.uom}`],
        ["Due", fmtDate(wo.dueDate) || "—"],
        ["Sales order", so ? `${so.number}${so.customerPo ? ` / PO ${so.customerPo}` : ""}` : "stock"],
        ["Priority", String(wo.priority)],
      ]}
      party={{ label: "Make", name: item.name, lines: item.description ? [item.description] : [] }}
      notes={wo.notes}
    >
      <h3 className="mb-1 mt-2 text-xs font-semibold uppercase text-ink-3">Materials</h3>
      <table className="data mb-6">
        <thead>
          <tr>
            <th>Part</th>
            <th>Description</th>
            <th className="num">Qty required</th>
            <th>Lot used</th>
            <th>Issued by</th>
          </tr>
        </thead>
        <tbody>
          {mats.map(({ m, sku, name }) => (
            <tr key={m.id}>
              <td className="font-mono text-xs">{sku}</td>
              <td>{name}</td>
              <td className="num">{fmtQty(m.qtyRequired)}</td>
              <td className="w-32"></td>
              <td className="w-28"></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="mb-1 text-xs font-semibold uppercase text-ink-3">Operations</h3>
      <table className="data">
        <thead>
          <tr>
            <th>Seq</th>
            <th>Operation and instructions</th>
            <th>Work center</th>
            <th className="num">Plan h</th>
            <th>Operator</th>
            <th className="num">Good</th>
            <th className="num">Scrap</th>
            <th>Date / sign</th>
          </tr>
        </thead>
        <tbody>
          {ops.map(({ op, wc }) => (
            <tr key={op.id} className="h-12 align-top">
              <td>{op.seq}</td>
              <td>
                <div className="font-medium">{op.name}</div>
                {op.instructions ? <div className="text-xs">{op.instructions}</div> : null}
              </td>
              <td>{op.outsideVendorId ? "Outside" : wc ?? ""}</td>
              <td className="num">{fmtQty(Number(op.plannedSetupHours) + Number(op.plannedRunHours))}</td>
              <td className="w-24"></td>
              <td className="w-14"></td>
              <td className="w-14"></td>
              <td className="w-28"></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-6 grid grid-cols-3 gap-6 text-xs">
        <div className="border-t border-ink pt-1">Final inspection</div>
        <div className="border-t border-ink pt-1">Packed by</div>
        <div className="border-t border-ink pt-1">Date</div>
      </div>
    </PrintDoc>
  );
}
