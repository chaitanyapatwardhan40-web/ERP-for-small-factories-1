import { notFound } from "next/navigation";
import { uuidOr404 } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { customers, orgs } from "@/lib/db/schema";
import { PrintDoc } from "@/components/print";
import { formatAddress } from "@/lib/forms";
import { customerStatement } from "@/modules/shipping/service";
import { fmtDate, fmtMoney, today } from "@/lib/money";

export default async function PrintStatementPage({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;
  uuidOr404(customerId);
  const ctx = await requireOrg();
  const db = await getDb();
  const [c] = await db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.orgId, ctx.orgId)));
  if (!c) notFound();
  const [org] = await db.select().from(orgs).where(eq(orgs.id, ctx.orgId));
  const asOf = today();
  const st = await customerStatement(db, ctx.orgId, c.id, asOf);
  const recent = st.rows.slice(-40);
  return (
    <PrintDoc
      title="Statement"
      number={fmtDate(asOf)}
      org={org}
      meta={[
        ["As of", fmtDate(asOf)],
        ["Terms", `Net ${c.termsDays}`],
        ["Balance due", fmtMoney(st.balance)],
      ]}
      party={{ label: "Account", name: c.name, lines: [...formatAddress(c.billingAddress), c.email ?? undefined].filter(Boolean) as string[] }}
      terms={org?.settings.documents?.invoiceTerms}
      footer="Please remit the open items listed. Payments received after the statement date are not reflected."
    >
      <table className="data">
        <thead>
          <tr>
            <th>Date</th>
            <th>Reference</th>
            <th>Description</th>
            <th className="num">Charges</th>
            <th className="num">Credits</th>
            <th className="num">Balance</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((r, i) => (
            <tr key={i}>
              <td>{fmtDate(r.date)}</td>
              <td className="font-mono text-xs">{r.ref}</td>
              <td>{r.description}</td>
              <td className="num">{r.charge ? fmtMoney(r.charge) : ""}</td>
              <td className="num">{r.credit ? fmtMoney(r.credit) : ""}</td>
              <td className="num">{fmtMoney(r.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {st.open.length ? (
        <>
          <h3 className="mb-1 mt-6 text-xs font-semibold uppercase text-ink-3">Open items</h3>
          <table className="data">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Due</th>
                <th className="num">Open</th>
              </tr>
            </thead>
            <tbody>
              {st.open.map((o) => (
                <tr key={o.number}>
                  <td className="font-mono text-xs">{o.number}</td>
                  <td className={o.dueDate < asOf ? "font-medium" : ""}>{fmtDate(o.dueDate)}</td>
                  <td className="num">{fmtMoney(o.open)}</td>
                </tr>
              ))}
              {st.unapplied ? (
                <tr>
                  <td colSpan={2}>Unapplied credit</td>
                  <td className="num">−{fmtMoney(st.unapplied)}</td>
                </tr>
              ) : null}
              <tr>
                <td colSpan={2} className="text-right font-semibold">
                  Balance due
                </td>
                <td className="num font-semibold">{fmtMoney(st.balance)}</td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}
    </PrintDoc>
  );
}
