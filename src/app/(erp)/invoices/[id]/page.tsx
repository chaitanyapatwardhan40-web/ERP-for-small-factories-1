import Link from "next/link";
import { uuidOr404 } from "@/lib/ids";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { customerPayments, customers, invoiceLines, invoices } from "@/lib/db/schema";
import { Card, DL, PageHeader, StatusBadge } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/fields";
import { customerPaymentAction } from "@/modules/shipping/actions";
import { fmtDate, fmtMoney, fmtQty, today } from "@/lib/money";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [row] = await db.select({ inv: invoices, customer: customers }).from(invoices).innerJoin(customers, eq(customers.id, invoices.customerId)).where(and(eq(invoices.id, id), eq(invoices.orgId, ctx.orgId)));
  if (!row) notFound();
  const { inv, customer } = row;
  const [lines, pays] = await Promise.all([
    db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.lineNo)),
    db.select().from(customerPayments).where(eq(customerPayments.invoiceId, inv.id)).orderBy(desc(customerPayments.paidAt)),
  ]);
  const open = Number(inv.total) - Number(inv.amountPaid);
  return (
    <>
      <PageHeader
        title={inv.number}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={inv.status} />
            <span>
              {customer.name} · issued {fmtDate(inv.issueDate)} · due {fmtDate(inv.dueDate)}
            </span>
          </span>
        }
        crumbs={[{ href: "/invoices", label: "Invoices" }]}
        actions={
          <>
            <LinkButton href={`/print/invoice/${inv.id}`} variant="secondary">
              Print / PDF
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
                    Subtotal
                  </td>
                  <td className="num">{fmtMoney(inv.subtotal)}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="text-right">
                    Tax ({Number(inv.taxRatePct).toFixed(2)}%)
                  </td>
                  <td className="num">{fmtMoney(inv.tax)}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="text-right font-semibold">
                    Total
                  </td>
                  <td className="num font-semibold">{fmtMoney(inv.total)}</td>
                </tr>
              </tfoot>
            </table>
          </Card>
          {pays.length ? (
            <Card title="Payments" padded={false}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Payment</th>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Reference</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {pays.map((p) => (
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
        </div>
        <div className="space-y-4">
          <Card title="Balance">
            <DL
              rows={[
                ["Customer", <Link key="c" href={`/customers/${customer.id}`} className="text-brand hover:underline">{customer.name}</Link>],
                ["Total", fmtMoney(inv.total)],
                ["Paid", fmtMoney(inv.amountPaid)],
                ["Open", <strong key="o">{fmtMoney(open)}</strong>],
              ]}
            />
          </Card>
          {inv.status === "issued" && open > 0 ? (
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
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
