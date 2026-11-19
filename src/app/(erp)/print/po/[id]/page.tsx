import { notFound } from "next/navigation";
import { uuidOr404 } from "@/lib/ids";
import { and, asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { items, orgs, purchaseOrderLines, purchaseOrders, vendors } from "@/lib/db/schema";
import { PrintDoc } from "@/components/print";
import { formatAddress } from "@/lib/forms";
import { poTotal } from "@/modules/purchasing/service";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/money";

export default async function PrintPoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [row] = await db.select({ po: purchaseOrders, vendor: vendors }).from(purchaseOrders).innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId)).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.orgId, ctx.orgId)));
  if (!row) notFound();
  const [org] = await db.select().from(orgs).where(eq(orgs.id, ctx.orgId));
  const lines = await db.select({ l: purchaseOrderLines, sku: items.sku }).from(purchaseOrderLines).leftJoin(items, eq(items.id, purchaseOrderLines.itemId)).where(eq(purchaseOrderLines.poId, row.po.id)).orderBy(asc(purchaseOrderLines.lineNo));
  const { po, vendor } = row;
  return (
    <PrintDoc
      title="Purchase order"
      number={po.revision > 1 ? `${po.number} rev ${po.revision}` : po.number}
      org={org}
      meta={[
        ["Date", fmtDate(po.orderDate)],
        ["Deliver by", fmtDate(po.expectedDate) || "—"],
        ["Terms", `Net ${po.termsDays ?? vendor.termsDays}`],
        ["Ship via", po.shipVia || "—"],
        ["Your ref", po.vendorRef || "—"],
      ]}
      party={{ label: "Vendor", name: vendor.name, lines: [...formatAddress(vendor.address), vendor.email ?? undefined, vendor.phone ?? undefined].filter(Boolean) as string[] }}
      secondParty={po.shipTo ? { label: "Ship to", name: org?.settings.company?.legalName || org?.name, lines: formatAddress(po.shipTo) } : undefined}
      notes={po.notes}
      terms={org?.settings.documents?.poTerms}
      footer="Please confirm receipt of this order and the delivery date. Quote the PO number on packing slips and invoices."
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
              <td className="font-mono text-xs">
                {l.vendorPartNo || sku || "—"}
                {l.vendorPartNo && sku ? <div className="text-ink-3">our {sku}</div> : null}
              </td>
              <td>
                {l.description}
                {l.notes ? <div className="text-xs text-ink-3">{l.notes}</div> : null}
              </td>
              <td className="num">{fmtQty(l.qty)}</td>
              <td>{fmtDate(l.expectedDate)}</td>
              <td className="num">{fmtMoney(l.unitCost)}</td>
              <td className="num">{fmtMoney(Number(l.qty) * Number(l.unitCost))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} className="text-right text-ink-2">
              Subtotal
            </td>
            <td className="num">{fmtMoney(po.subtotal)}</td>
          </tr>
          {Number(po.freight) ? (
            <tr>
              <td colSpan={6} className="text-right text-ink-2">
                Freight
              </td>
              <td className="num">{fmtMoney(po.freight)}</td>
            </tr>
          ) : null}
          {Number(po.tax) ? (
            <tr>
              <td colSpan={6} className="text-right text-ink-2">
                Tax
              </td>
              <td className="num">{fmtMoney(po.tax)}</td>
            </tr>
          ) : null}
          <tr>
            <td colSpan={6} className="text-right font-semibold">
              Total
            </td>
            <td className="num font-semibold">{fmtMoney(poTotal(po))}</td>
          </tr>
        </tfoot>
      </table>
    </PrintDoc>
  );
}
