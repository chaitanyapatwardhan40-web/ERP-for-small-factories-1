import Link from "@/components/ui/link";
import { uuidOr404 } from "@/lib/ids";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { customerPaymentApplications, customerPayments, customers, invoiceLines, invoices, items, shipments } from "@/lib/db/schema";
import { pickLocations } from "@/lib/pick";
import { Badge, Card, DL, PageHeader, StatusBadge } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/fields";
import { applyCreditAction, creditMemoAction, customerPaymentAction, voidInvoiceAction } from "@/modules/shipping/actions";
import { unappliedPayments } from "@/modules/shipping/service";
import { fmtDate, fmtMoney, fmtQty, today } from "@/lib/money";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [row] = await db.select({ inv: invoices, customer: customers }).from(invoices).innerJoin(customers, eq(customers.id, invoices.customerId)).where(and(eq(invoices.id, id), eq(invoices.orgId, ctx.orgId)));
  if (!row) notFound();
  const { inv, customer } = row;
  const [lines, apps, credits, credit, parent, sh, locs, shipLines] = await Promise.all([
    db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.lineNo)),
    db.select({ a: customerPaymentApplications, p: customerPayments }).from(customerPaymentApplications).innerJoin(customerPayments, eq(customerPayments.id, customerPaymentApplications.paymentId)).where(eq(customerPaymentApplications.invoiceId, inv.id)).orderBy(desc(customerPayments.paidAt)),
    db.select().from(invoices).where(and(eq(invoices.creditOfInvoiceId, inv.id), eq(invoices.kind, "credit_memo"))).orderBy(desc(invoices.issueDate)),
    unappliedPayments(db, ctx.orgId, customer.id),
    inv.creditOfInvoiceId ? db.select().from(invoices).where(eq(invoices.id, inv.creditOfInvoiceId)).then((r) => r[0]) : Promise.resolve(undefined),
    inv.shipmentId ? db.select().from(shipments).where(eq(shipments.id, inv.shipmentId)).then((r) => r[0]) : Promise.resolve(undefined),
    pickLocations(db, ctx.orgId),
    db.select({ id: items.id, sku: items.sku }).from(invoiceLines).innerJoin(items, eq(items.id, invoiceLines.itemId)).where(eq(invoiceLines.invoiceId, inv.id)),
  ]);
  // Older payments recorded straight on the invoice have no application row.
  const legacy = await db.select().from(customerPayments).where(eq(customerPayments.invoiceId, inv.id));
  const payRows = [
    ...apps.map(({ a, p }) => ({ id: a.id, number: p.number, paidAt: p.paidAt, method: p.method, reference: p.reference, amount: Number(a.amount) })),
    ...legacy.filter((p) => !apps.some((x) => x.p.id === p.id)).map((p) => ({ id: p.id, number: p.number, paidAt: p.paidAt, method: p.method, reference: p.reference, amount: Number(p.amount) })),
  ];
  const open = Number(inv.total) - Number(inv.amountPaid);
  const isCredit = inv.kind === "credit_memo";
  const stockLocs = locs.filter((l) => l.type === "stock" || l.type === "quarantine");
  const creditedSoFar = credits.filter((c) => c.status !== "void").reduce((s, c) => s + Number(c.total), 0);
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {inv.number}
            {isCredit ? <Badge tone="info">credit memo</Badge> : null}
          </span>
        }
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={inv.status} />
            <span>
              {customer.name} · issued {fmtDate(inv.issueDate)}
              {!isCredit ? ` · due ${fmtDate(inv.dueDate)}` : ""}
              {parent ? (
                <>
                  {" "}
                  · against{" "}
                  <Link href={`/invoices/${parent.id}`} className="text-brand hover:underline">
                    {parent.number}
                  </Link>
                </>
              ) : null}
            </span>
          </span>
        }
        crumbs={[{ href: "/invoices", label: "Invoices" }]}
        actions={
          <>
            <LinkButton href={`/print/invoice/${inv.id}`} variant="secondary">
              Print / PDF
            </LinkButton>
            <LinkButton href={`/print/statement/${customer.id}`} variant="secondary">
              Statement
            </LinkButton>
            {inv.orderId ? (
              <LinkButton href={`/orders/${inv.orderId}`} variant="secondary">
                Order
              </LinkButton>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Lines" padded={false}>
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
                    <td className="text-ink-3">{l.lineNo}</td>
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
                    Subtotal{Number(inv.freight) ? ` (incl. freight ${fmtMoney(inv.freight)})` : ""}
                  </td>
                  <td className="num">{fmtMoney(inv.subtotal)}</td>
                </tr>
                {Number(inv.tax) ? (
                  <tr>
                    <td colSpan={4} className="text-right">
                      Tax {Number(inv.taxRatePct)}%
                    </td>
                    <td className="num">{fmtMoney(inv.tax)}</td>
                  </tr>
                ) : null}
                <tr>
                  <td colSpan={4} className="text-right font-semibold">
                    Total
                  </td>
                  <td className="num font-semibold">{fmtMoney(inv.total)}</td>
                </tr>
              </tfoot>
            </table>
          </Card>
          {payRows.length ? (
            <Card title="Payments applied" padded={false}>
              <table className="data">
                <tbody>
                  {payRows.map((p) => (
                    <tr key={p.id}>
                      <td className="font-mono text-xs">{p.number}</td>
                      <td>{fmtDate(p.paidAt)}</td>
                      <td>{p.method}</td>
                      <td>{p.reference}</td>
                      <td className="num">{fmtMoney(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}
          {credits.length ? (
            <Card title="Credit memos" padded={false}>
              <table className="data">
                <tbody>
                  {credits.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/invoices/${c.id}`} className="font-mono text-xs text-brand hover:underline">
                          {c.number}
                        </Link>
                      </td>
                      <td>{fmtDate(c.issueDate)}</td>
                      <td>{c.memo}</td>
                      <td className="num">{fmtMoney(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}
        </div>
        <div className="space-y-4">
          <Card title="Balance">
            <DL
              rows={[
                ["Customer", <Link key="c" href={`/customers/${customer.id}`} className="text-brand hover:underline">{customer.name}</Link>],
                ["Shipment", sh ? <Link key="s" href={`/shipments/${sh.id}`} className="text-brand hover:underline">{sh.number}</Link> : null],
                ["Terms", inv.termsDays != null ? `Net ${inv.termsDays}` : null],
                ["Total", fmtMoney(inv.total)],
                ["Paid", fmtMoney(inv.amountPaid)],
                ["Open", <strong key="o">{fmtMoney(open)}</strong>],
                ["Memo", inv.memo],
              ]}
            />
          </Card>
          {!isCredit && inv.status === "issued" && open > 0 ? (
            <Card title="Record a payment">
              <ActionForm action={customerPaymentAction} className="space-y-2">
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Input name="amount" type="number" step="0.01" defaultValue={open.toFixed(2)} required />
                <Input name="paidAt" type="date" defaultValue={today()} required />
                <Select name="method" defaultValue="check">
                  <option value="check">Check</option>
                  <option value="ach">ACH</option>
                  <option value="card">Card</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </Select>
                <Input name="reference" placeholder="Check # / reference" />
                <SubmitButton className="w-full">Record payment</SubmitButton>
              </ActionForm>
              <p className="mt-2 text-xs text-ink-3">
                Paying several invoices with one check?{" "}
                <Link href={`/invoices/receive?customerId=${customer.id}`} className="text-brand hover:underline">
                  Receive payment
                </Link>
              </p>
            </Card>
          ) : null}
          {!isCredit && inv.status === "issued" && open > 0 && credit.length ? (
            <Card title="Apply customer credit">
              <ActionForm action={applyCreditAction} className="space-y-2">
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Select name="paymentId" required defaultValue={credit[0].id}>
                  {credit.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.number} · {fmtMoney(p.unapplied)} unapplied
                    </option>
                  ))}
                </Select>
                <Input name="amount" type="number" step="0.01" defaultValue={Math.min(open, Number(credit[0].unapplied)).toFixed(2)} required />
                <SubmitButton variant="secondary" className="w-full">
                  Apply
                </SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
          {!isCredit && inv.status !== "void" && Number(inv.total) - creditedSoFar > 0 ? (
            <Card title="Credit memo">
              <ActionForm action={creditMemoAction} className="space-y-2">
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Input name="amount" type="number" step="0.01" min="0.01" max={(Number(inv.total) - creditedSoFar).toFixed(2)} placeholder="Amount" required />
                <Input name="reason" placeholder="Reason (printed on the memo)" required />
                <details className="text-xs text-ink-2">
                  <summary className="cursor-pointer">Returned goods back to stock</summary>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Select name="restockItemId" defaultValue="">
                      <option value="">Item</option>
                      {shipLines.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.sku}
                        </option>
                      ))}
                    </Select>
                    <Input name="restockQty" type="number" step="0.0001" min="0" placeholder="Qty" />
                    <Select name="restockLocationId" defaultValue={stockLocs[0]?.id ?? ""}>
                      {stockLocs.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code}
                        </option>
                      ))}
                    </Select>
                  </div>
                </details>
                <SubmitButton variant="secondary" className="w-full">
                  Issue credit memo
                </SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
          {!isCredit && inv.status === "issued" && Number(inv.amountPaid) === 0 ? (
            <Card title="Void">
              <ActionForm action={voidInvoiceAction} className="space-y-2">
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Input name="reason" placeholder="Reason" required />
                <SubmitButton variant="danger" className="w-full">
                  Void invoice
                </SubmitButton>
              </ActionForm>
              <p className="mt-2 text-xs text-ink-3">Reverses the postings and lets the shipment be invoiced again.</p>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
