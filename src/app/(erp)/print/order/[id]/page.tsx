import { notFound } from "next/navigation";
import { uuidOr404 } from "@/lib/ids";
import { and, asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { customers, items, orgs, salesOrderLines, salesOrders } from "@/lib/db/schema";
import { PrintDoc } from "@/components/print";
import { formatAddress } from "@/lib/forms";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/money";

export default async function PrintOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [row] = await db.select({ o: salesOrders, customer: customers }).from(salesOrders).innerJoin(customers, eq(customers.id, salesOrders.customerId)).where(and(eq(salesOrders.id, id), eq(salesOrders.orgId, ctx.orgId)));
  if (!row) notFound();
  const [org] = await db.select().from(orgs).where(eq(orgs.id, ctx.orgId));
  const lines = await db.select({ l: salesOrderLines, sku: items.sku }).from(salesOrderLines).innerJoin(items, eq(items.id, salesOrderLines.itemId)).where(eq(salesOrderLines.orderId, row.o.id)).orderBy(asc(salesOrderLines.lineNo));
  const ship = row.o.shipTo ?? row.customer.shippingAddress ?? row.customer.billingAddress;
  const bill = row.customer.billingAddress;
  return (
    <PrintDoc
      title="Order acknowledgement"
      number={row.o.number}
      org={org}
      meta={[
        ["Order date", fmtDate(row.o.orderDate)],
        ["Promised", fmtDate(row.o.promisedDate) || "—"],
        ["Your PO", row.o.customerPo ?? "—"],
        ["Terms", `Net ${row.o.termsDays ?? row.customer.termsDays}`],
        ["Ship via", row.o.shipVia || "—"],
      ]}
      party={{ label: "Bill to", name: row.customer.name, lines: formatAddress(bill) }}
      secondParty={{ label: "Ship to", name: row.customer.name, lines: formatAddress(ship) }}
      notes={row.o.notes}
      terms={org?.settings.documents?.invoiceTerms}
    >
      <table className="data">
        <thead>
          <tr>
            <th>#</th>
            <th>Part</th>
            <th>Description</th>
            <th className="num">Qty</th>
            <th>Promised</th>
            <th className="num">Unit price</th>
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
              <td>{fmtDate(l.promisedDate)}</td>
              <td className="num">{fmtMoney(l.unitPrice)}</td>
              <td className="num">{fmtMoney((Number(l.qty) - Number(l.qtyCancelled)) * Number(l.unitPrice) * (1 - Number(l.discountPct) / 100))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} className="text-right font-semibold">
              Total
            </td>
            <td className="num font-semibold">{fmtMoney(row.o.subtotal)}</td>
          </tr>
        </tfoot>
      </table>
    </PrintDoc>
  );
}
