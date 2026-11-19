import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { pickCustomers } from "@/lib/pick";
import { Card, PageHeader } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select } from "@/components/ui/fields";
import { receivePaymentAction } from "@/modules/shipping/actions";
import { openInvoicesForCustomer } from "@/modules/shipping/service";
import { fmtDate, fmtMoney, today } from "@/lib/money";

export const metadata = { title: "Receive payment" };

export default async function ReceivePaymentPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const { customerId } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const [customerList, open] = await Promise.all([pickCustomers(db, ctx.orgId), customerId ? openInvoicesForCustomer(db, ctx.orgId, customerId) : Promise.resolve([])]);
  const total = open.reduce((s, i) => s + i.open, 0);
  return (
    <>
      <PageHeader title="Receive payment" crumbs={[{ href: "/invoices", label: "Invoices" }]} description="One payment, applied across the customer's open invoices." />
      <form method="get" action="/invoices/receive" className="mb-4 flex items-end gap-2">
        <div className="w-80">
          <span className="mb-1 block text-xs font-medium text-ink-2">Customer</span>
          <Select name="customerId" defaultValue={customerId ?? ""}>
            <option value="">Select customer</option>
            {customerList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <button type="submit" className="h-9 rounded border border-line bg-white px-3 text-sm hover:bg-paper">
          Load invoices
        </button>
      </form>
      {customerId ? (
        <ActionForm action={receivePaymentAction} className="space-y-4">
          <input type="hidden" name="customerId" value={customerId} />
          <Card>
            <FormGrid cols={4}>
              <Field label="Amount received">
                <Input name="amount" type="number" step="0.01" min="0.01" defaultValue={total ? total.toFixed(2) : ""} required />
              </Field>
              <Field label="Date">
                <Input name="paidAt" type="date" defaultValue={today()} required />
              </Field>
              <Field label="Method">
                <Select name="method" defaultValue="check">
                  <option value="check">Check</option>
                  <option value="ach">ACH</option>
                  <option value="card">Card</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <Field label="Reference">
                <Input name="reference" placeholder="Check # / remittance" />
              </Field>
            </FormGrid>
          </Card>
          <Card title={`Open invoices · ${fmtMoney(total)}`} padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Issued</th>
                  <th>Due</th>
                  <th className="num">Total</th>
                  <th className="num">Open</th>
                  <th className="num w-36">Apply</th>
                </tr>
              </thead>
              <tbody>
                {open.map((i, idx) => (
                  <tr key={i.id}>
                    <td className="font-mono text-xs">
                      <input type="hidden" name={`apply[${idx}][invoiceId]`} value={i.id} />
                      {i.number}
                    </td>
                    <td>{fmtDate(i.issueDate)}</td>
                    <td className={i.dueDate < today() ? "text-bad" : ""}>{fmtDate(i.dueDate)}</td>
                    <td className="num">{fmtMoney(i.total)}</td>
                    <td className="num">{fmtMoney(i.open)}</td>
                    <td>
                      <Input name={`apply[${idx}][amount]`} type="number" step="0.01" min="0" max={i.open.toFixed(2)} defaultValue={i.open.toFixed(2)} className="text-right" />
                    </td>
                  </tr>
                ))}
                {!open.length ? (
                  <tr>
                    <td colSpan={6} className="text-ink-3">
                      Nothing open. A payment recorded now is held as unapplied credit.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
          <p className="text-xs text-ink-3">Clear an amount to skip that invoice. Anything received above what is applied is kept as credit on the customer and can be applied later.</p>
          <SubmitButton>Record payment</SubmitButton>
        </ActionForm>
      ) : null}
    </>
  );
}
