import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { customers, invoiceLines, invoices, orgs, salesOrders } from "@/lib/db/schema";
import { PrintDoc } from "@/components/print";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/money";

export default async function PrintInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg();
  const db = await getDb();
  const [row] = await db.select({ inv: invoices, customer: customers, order: salesOrders }).from(invoices).innerJoin(customers, eq(customers.id, invoices.customerId)).leftJoin(salesOrders, eq(salesOrders.id, invoices.orderId)).where(and(eq(invoices.id, id), eq(invoices.orgId, ctx.orgId)));
  if (!row) notFound();
  const [org] = await db.select().from(orgs).where(eq(orgs.id, ctx.orgId));
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, row.inv.id)).orderBy(asc(invoiceLines.lineNo));
  const a = row.customer.billingAddress;
  return (
    <PrintDoc
      title="Invoice"
      number={row.inv.number}
      org={org}
      meta={[
        ["Invoice date", fmtDate(row.inv.issueDate)],
        ["Due", fmtDate(row.inv.dueDate)],
        ["Terms", `Net ${row.customer.termsDays}`],
        ["Your PO", row.order?.customerPo ?? "—"],
        ["Order", row.order?.number ?? "—"],
      ]}
      party={{ label: "Bill to", name: row.customer.name, lines: [a?.line1, [a?.city, a?.state, a?.postalCode].filter(Boolean).join(" "), row.customer.email].filter(Boolean) as string[] }}
      notes={row.inv.notes}
      footer={`Please remit ${fmtMoney(Number(row.inv.total) - Number(row.inv.amountPaid))} by ${fmtDate(row.inv.dueDate)}. Thank you for your business.`}
    >
      <table className="data">
        <thead>
          <tr>
            <th>#</th>
            <th>Description</th>
            <th className="num">Qty</th>
            <th className="num">Unit price</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td>{l.lineNo}</td>
              <td>{l.description}</td>
              <td className="num">{fmtQty(l.qty)}</td>
              <td className="num">{fmtMoney(l.unitPrice)}</td>
              <td className="num">{fmtMoney(l.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="text-right">
              Subtotal
            </td>
            <td className="num">{fmtMoney(row.inv.subtotal)}</td>
          </tr>
          <tr>
            <td colSpan={4} className="text-right">
              Tax
            </td>
            <td className="num">{fmtMoney(row.inv.tax)}</td>
          </tr>
          <tr>
            <td colSpan={4} className="text-right font-semibold">
              Total due
            </td>
            <td className="num font-semibold">{fmtMoney(Number(row.inv.total) - Number(row.inv.amountPaid))}</td>
          </tr>
        </tfoot>
      </table>
    </PrintDoc>
  );
}
