import Link from "@/components/ui/link";
import { uuidOr404 } from "@/lib/ids";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { purchaseOrderLines, purchaseOrders, vendorBillLines, vendorBills, vendorPayments, vendors } from "@/lib/db/schema";
import { Card, DL, PageHeader, StatusBadge } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/fields";
import { payBillAction, voidBillAction } from "@/modules/purchasing/actions";
import { fmtDate, fmtMoney, fmtQty, today } from "@/lib/money";

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [row] = await db.select({ b: vendorBills, vendor: vendors, po: purchaseOrders }).from(vendorBills).innerJoin(vendors, eq(vendors.id, vendorBills.vendorId)).leftJoin(purchaseOrders, eq(purchaseOrders.id, vendorBills.poId)).where(and(eq(vendorBills.id, id), eq(vendorBills.orgId, ctx.orgId)));
  if (!row) notFound();
  const { b, vendor, po } = row;
  const [lines, pays, poLines] = await Promise.all([
    db.select().from(vendorBillLines).where(eq(vendorBillLines.billId, b.id)),
    db.select().from(vendorPayments).where(eq(vendorPayments.billId, b.id)).orderBy(desc(vendorPayments.paidAt)),
    po ? db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id)) : Promise.resolve([]),
  ]);
  const open = Number(b.total) - Number(b.amountPaid);
  // Three-way match: ordered vs received vs billed, per PO line on this bill.
  const match = lines
    .filter((l) => l.poLineId)
    .map((l) => {
      const pl = poLines.find((p) => p.id === l.poLineId);
      const ok = !pl || pl.lineType === "service" || (Number(l.unitCost) <= Number(pl.unitCost) + 1e-9 && Number(pl.qtyBilled) <= Number(pl.qtyReceived) + 1e-9);
      return { lineId: l.id, ordered: pl ? Number(pl.qty) : null, received: pl ? Number(pl.qtyReceived) : null, poCost: pl ? Number(pl.unitCost) : null, ok };
    });
  const matched = match.length > 0 && match.every((m) => m.ok);
  return (
    <>
      <PageHeader
        title={b.number}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={b.status} />
            <span>
              {vendor.name} · {fmtDate(b.billDate)} · due {fmtDate(b.dueDate)}
              {b.vendorRef ? ` · ref ${b.vendorRef}` : ""}
            </span>
          </span>
        }
        crumbs={[{ href: "/bills", label: "Vendor bills" }]}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Lines" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit cost</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.description}</td>
                    <td className="num">{fmtQty(l.qty)}</td>
                    <td className="num">{fmtMoney(l.unitCost)}</td>
                    <td className="num">{fmtMoney(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="text-right">
                    Subtotal
                  </td>
                  <td className="num">{fmtMoney(b.subtotal)}</td>
                </tr>
                {Number(b.tax) ? (
                  <tr>
                    <td colSpan={3} className="text-right">
                      Tax
                    </td>
                    <td className="num">{fmtMoney(b.tax)}</td>
                  </tr>
                ) : null}
                {Number(b.freight) ? (
                  <tr>
                    <td colSpan={3} className="text-right">
                      Freight
                    </td>
                    <td className="num">{fmtMoney(b.freight)}</td>
                  </tr>
                ) : null}
                <tr>
                  <td colSpan={3} className="text-right font-semibold">
                    Total
                  </td>
                  <td className="num font-semibold">{fmtMoney(b.total)}</td>
                </tr>
              </tfoot>
            </table>
          </Card>
          {pays.length ? (
            <Card title="Payments" padded={false}>
              <table className="data">
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
                ["Vendor", <Link key="v" href={`/vendors/${vendor.id}`} className="text-brand hover:underline">{vendor.name}</Link>],
                ["PO", po ? <Link key="p" href={`/purchasing/${po.id}`} className="text-brand hover:underline">{po.number}</Link> : "expense bill"],
                ["Total", fmtMoney(b.total)],
                ["Paid", fmtMoney(b.amountPaid)],
                ["Open", <strong key="o">{fmtMoney(open)}</strong>],
                ["Match", po ? (matched ? "Ordered, received and billed agree" : match.length ? "Check: billed exceeds received or PO cost" : "No PO lines") : "—"],
                ["Notes", b.notes],
              ]}
            />
          </Card>
          {b.status === "approved" && Number(b.amountPaid) === 0 ? (
            <Card title="Void">
              <ActionForm action={voidBillAction} className="space-y-2">
                <input type="hidden" name="billId" value={b.id} />
                <Input name="reason" placeholder="Reason" required />
                <SubmitButton variant="danger" className="w-full">
                  Void bill
                </SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
          {b.status === "approved" && open > 0 ? (
            <Card title="Pay">
              <ActionForm action={payBillAction} className="space-y-2">
                <input type="hidden" name="billId" value={b.id} />
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
