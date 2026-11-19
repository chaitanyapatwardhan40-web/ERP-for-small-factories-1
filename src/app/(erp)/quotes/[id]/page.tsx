import Link from "@/components/ui/link";
import { uuidOr404 } from "@/lib/ids";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { customers, items, leads, quoteLines, quotes } from "@/lib/db/schema";
import { Card, DL, PageHeader, StatusBadge } from "@/components/ui/page";
import { Button, LinkButton } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/fields";
import { acceptQuoteAction, deleteQuoteAction, quoteStatusAction } from "@/modules/sales/actions";
import { DeleteCard } from "@/components/forms/delete-card";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/money";

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [row] = await db
    .select({ q: quotes, customer: customers })
    .from(quotes)
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .where(and(eq(quotes.id, id), eq(quotes.orgId, ctx.orgId)));
  if (!row) notFound();
  const { q, customer } = row;
  const lines = await db
    .select({ l: quoteLines, sku: items.sku })
    .from(quoteLines)
    .leftJoin(items, eq(items.id, quoteLines.itemId))
    .where(eq(quoteLines.quoteId, q.id))
    .orderBy(asc(quoteLines.lineNo));
  const lead = q.leadId ? (await db.select({ id: leads.id, company: leads.company, stage: leads.stage }).from(leads).where(eq(leads.id, q.leadId)))[0] : undefined;
  const cost = lines.reduce((s, { l }) => s + Number(l.qty) * (Number(l.materialCost) + Number(l.laborCost) + Number(l.outsideCost) + Number(l.overheadCost)), 0);
  const margin = Number(q.subtotal) - cost;
  const editable = q.status === "draft" || q.status === "sent";
  return (
    <>
      <PageHeader
        title={q.number}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={q.status} />
            <span>
              {customer.name} · {fmtDate(q.quoteDate)}
              {q.validUntil ? ` · valid until ${fmtDate(q.validUntil)}` : ""}
            </span>
          </span>
        }
        crumbs={[{ href: "/quotes", label: "Quotes" }]}
        actions={
          <>
            <LinkButton href={`/print/quote/${q.id}`} variant="secondary">
              Print / PDF
            </LinkButton>
            {q.status !== "accepted" ? (
              <LinkButton href={`/quotes/${q.id}/edit`} variant="secondary">
                Edit
              </LinkButton>
            ) : null}
            {q.status === "draft" ? (
              <form action={quoteStatusAction}>
                <input type="hidden" name="id" value={q.id} />
                <input type="hidden" name="status" value="sent" />
                <Button type="submit" variant="secondary">
                  Mark sent
                </Button>
              </form>
            ) : null}
            {q.convertedOrderId ? (
              <LinkButton href={`/orders/${q.convertedOrderId}`}>Open order</LinkButton>
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
                  <th>Item</th>
                  <th>Description</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit cost</th>
                  <th className="num">Margin</th>
                  <th className="num">Unit price</th>
                  <th className="num">Ext.</th>
                  <th className="num">Lead</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(({ l, sku }) => {
                  const unitCost = Number(l.materialCost) + Number(l.laborCost) + Number(l.outsideCost) + Number(l.overheadCost);
                  return (
                    <tr key={l.id}>
                      <td className="text-ink-3">{l.lineNo}</td>
                      <td>{l.itemId ? <Link href={`/items/${l.itemId}`} className="text-brand hover:underline">{sku}</Link> : <span className="text-ink-3">custom</span>}</td>
                      <td>{l.description}</td>
                      <td className="num">{fmtQty(l.qty)}</td>
                      <td className="num" title={`M ${fmtMoney(l.materialCost)} · L ${fmtMoney(l.laborCost)} · O ${fmtMoney(l.outsideCost)} · OH ${fmtMoney(l.overheadCost)}`}>
                        {fmtMoney(unitCost)}
                      </td>
                      <td className="num">{Number(l.unitPrice) ? `${(((Number(l.unitPrice) - unitCost) / Number(l.unitPrice)) * 100).toFixed(0)}%` : "—"}</td>
                      <td className="num">{fmtMoney(l.unitPrice)}</td>
                      <td className="num">{fmtMoney(Number(l.qty) * Number(l.unitPrice) * (1 - Number(l.discountPct) / 100))}{Number(l.discountPct) ? <span className="ml-1 text-xs text-ink-3">−{Number(l.discountPct)}%</span> : null}</td>
                      <td className="num">{l.leadTimeDays} d</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7} className="text-right font-medium">
                    Total
                  </td>
                  <td className="num font-semibold">{fmtMoney(q.subtotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </Card>
          {q.notes ? (
            <Card title="Notes">
              <p className="whitespace-pre-wrap text-sm">{q.notes}</p>
            </Card>
          ) : null}
        </div>
        <div className="space-y-4">
          <Card title="Summary">
            <DL
              rows={[
                ["Customer", <Link key="c" href={`/customers/${customer.id}`} className="text-brand hover:underline">{customer.name}</Link>],
                ["RFQ", q.customerRfq],
                ["Lead", lead ? <Link key="l" href={`/crm/${lead.id}`} className="text-brand hover:underline">{lead.company} · {lead.stage}</Link> : null],
                ["Estimated cost", fmtMoney(cost)],
                ["Gross margin", `${fmtMoney(margin)} (${q.subtotal ? ((margin / Number(q.subtotal)) * 100).toFixed(0) : 0}%)`],
                ["Revision", q.revision],
                ["Attention", q.contactName],
                ["Quote discount", Number(q.discountPct) ? `${Number(q.discountPct)}%` : null],
                ["Lost reason", q.lostReason],
              ]}
            />
          </Card>
          {editable ? (
            <>
              <Card title="Won it?">
                <ActionForm action={acceptQuoteAction} className="space-y-2">
                  <input type="hidden" name="id" value={q.id} />
                  <Input name="customerPo" placeholder="Customer PO number (optional)" />
                  <SubmitButton className="w-full">Accept and create sales order</SubmitButton>
                </ActionForm>
                <p className="mt-2 text-xs text-ink-3">Each line needs an item before the quote can be converted.</p>
              </Card>
              <Card title="Lost it?">
                <form action={quoteStatusAction} className="flex gap-2">
                  <input type="hidden" name="id" value={q.id} />
                  <input type="hidden" name="status" value="lost" />
                  <Input name="reason" placeholder="Reason (price, lead time…)" />
                  <Button type="submit" variant="danger">
                    Mark lost
                  </Button>
                </form>
              </Card>
            </>
          ) : null}
          {q.status !== "accepted" ? <DeleteCard action={deleteQuoteAction} id={q.id} label={q.number} /> : null}
        </div>
      </div>
    </>
  );
}
