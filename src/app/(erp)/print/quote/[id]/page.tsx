import { notFound } from "next/navigation";
import { uuidOr404 } from "@/lib/ids";
import { and, asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { customers, orgs, quoteLines, quotes } from "@/lib/db/schema";
import { PrintDoc } from "@/components/print";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/money";

export default async function PrintQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [row] = await db.select({ q: quotes, customer: customers }).from(quotes).innerJoin(customers, eq(customers.id, quotes.customerId)).where(and(eq(quotes.id, id), eq(quotes.orgId, ctx.orgId)));
  if (!row) notFound();
  const [org] = await db.select().from(orgs).where(eq(orgs.id, ctx.orgId));
  const lines = await db.select().from(quoteLines).where(eq(quoteLines.quoteId, row.q.id)).orderBy(asc(quoteLines.lineNo));
  const a = row.customer.billingAddress;
  return (
    <PrintDoc
      title="Quotation"
      number={row.q.number}
      org={org}
      meta={[
        ["Date", fmtDate(row.q.quoteDate)],
        ["Valid until", fmtDate(row.q.validUntil) || "30 days"],
        ["Your RFQ", row.q.customerRfq ?? "—"],
      ]}
      party={{ label: "Quoted to", name: row.customer.name, lines: [a?.line1, [a?.city, a?.state, a?.postalCode].filter(Boolean).join(" "), row.customer.email].filter(Boolean) as string[] }}
      notes={row.q.notes}
    >
      <table className="data">
        <thead>
          <tr>
            <th>#</th>
            <th>Description</th>
            <th className="num">Qty</th>
            <th className="num">Unit price</th>
            <th className="num">Amount</th>
            <th className="num">Lead time</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td>{l.lineNo}</td>
              <td>{l.description}</td>
              <td className="num">{fmtQty(l.qty)}</td>
              <td className="num">{fmtMoney(l.unitPrice)}</td>
              <td className="num">{fmtMoney(Number(l.qty) * Number(l.unitPrice))}</td>
              <td className="num">{l.leadTimeDays} days</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="text-right font-semibold">
              Total
            </td>
            <td className="num font-semibold">{fmtMoney(row.q.subtotal)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </PrintDoc>
  );
}
