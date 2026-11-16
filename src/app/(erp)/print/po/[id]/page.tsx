import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { items, orgs, purchaseOrderLines, purchaseOrders, vendors } from "@/lib/db/schema";
import { PrintDoc } from "@/components/print";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/money";

export default async function PrintPoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg();
  const db = await getDb();
  const [row] = await db.select({ po: purchaseOrders, vendor: vendors }).from(purchaseOrders).innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId)).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.orgId, ctx.orgId)));
  if (!row) notFound();
  const [org] = await db.select().from(orgs).where(eq(orgs.id, ctx.orgId));
  const lines = await db.select({ l: purchaseOrderLines, sku: items.sku }).from(purchaseOrderLines).innerJoin(items, eq(items.id, purchaseOrderLines.itemId)).where(eq(purchaseOrderLines.poId, row.po.id)).orderBy(asc(purchaseOrderLines.lineNo));
  const a = row.vendor.address;
  return (
    <PrintDoc
      title="Purchase order"
      number={row.po.number}
      org={org}
      meta={[
        ["Date", fmtDate(row.po.orderDate)],
        ["Deliver by", fmtDate(row.po.expectedDate) || "—"],
        ["Terms", `Net ${row.vendor.termsDays}`],
      ]}
      party={{ label: "Vendor", name: row.vendor.name, lines: [a?.line1, [a?.city, a?.state, a?.postalCode].filter(Boolean).join(" "), row.vendor.email].filter(Boolean) as string[] }}
      notes={row.po.notes}
      footer="Please confirm receipt of this order and the delivery date."
    >
      <table className="data">
        <thead>
          <tr>
            <th>#</th>
            <th>Part</th>
            <th>Description</th>
            <th className="num">Qty</th>
            <th>Need by</th>
            <th className="num">Unit cost</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(({ l, sku }) => (
            <tr key={l.id}>
              <td>{l.lineNo}</td>
              <td className="font-mono text-xs">{sku}</td>
              <td>{l.description}</td>
              <td className="num">{fmtQty(l.qty)}</td>
              <td>{fmtDate(l.expectedDate)}</td>
              <td className="num">{fmtMoney(l.unitCost)}</td>
              <td className="num">{fmtMoney(Number(l.qty) * Number(l.unitCost))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} className="text-right font-semibold">
              Total
            </td>
            <td className="num font-semibold">{fmtMoney(row.po.subtotal)}</td>
          </tr>
        </tfoot>
      </table>
    </PrintDoc>
  );
}
