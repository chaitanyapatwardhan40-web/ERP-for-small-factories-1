import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { activities, contacts, customers, invoices, quotes, salesOrders } from "@/lib/db/schema";
import { Card, DL, PageHeader, StatusBadge } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { ActivityCard, ContactsCard } from "@/components/forms/party-side";
import { fmtDate, fmtMoney } from "@/lib/money";

function addr(a?: { line1?: string; city?: string; state?: string; postalCode?: string } | null) {
  if (!a) return "—";
  return [a.line1, [a.city, a.state].filter(Boolean).join(", "), a.postalCode].filter(Boolean).join(" · ");
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg();
  const db = await getDb();
  const [c] = await db.select().from(customers).where(and(eq(customers.id, id), eq(customers.orgId, ctx.orgId)));
  if (!c) notFound();
  const [orders, qs, invs, cts, acts] = await Promise.all([
    db.select().from(salesOrders).where(eq(salesOrders.customerId, c.id)).orderBy(desc(salesOrders.orderDate)).limit(20),
    db.select().from(quotes).where(eq(quotes.customerId, c.id)).orderBy(desc(quotes.quoteDate)).limit(20),
    db.select().from(invoices).where(eq(invoices.customerId, c.id)).orderBy(desc(invoices.issueDate)).limit(20),
    db.select().from(contacts).where(and(eq(contacts.partyType, "customer"), eq(contacts.partyId, c.id))),
    db.select().from(activities).where(and(eq(activities.partyType, "customer"), eq(activities.partyId, c.id))).orderBy(desc(activities.at)).limit(20),
  ]);
  const openAr = invs.filter((i) => i.status === "issued").reduce((s, i) => s + Number(i.total) - Number(i.amountPaid), 0);
  return (
    <>
      <PageHeader
        title={c.name}
        description={`${c.code} · Net ${c.termsDays}${c.taxExempt ? " · tax exempt" : ""}`}
        crumbs={[{ href: "/customers", label: "Customers" }]}
        actions={
          <>
            <LinkButton href={`/quotes/new?customerId=${c.id}`} variant="secondary">
              New quote
            </LinkButton>
            <LinkButton href={`/orders/new?customerId=${c.id}`} variant="secondary">
              New order
            </LinkButton>
            <LinkButton href={`/customers/${c.id}/edit`}>Edit</LinkButton>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Details">
            <DL
              rows={[
                ["Email", c.email],
                ["Phone", c.phone],
                ["Billing", addr(c.billingAddress)],
                ["Shipping", addr(c.shippingAddress)],
                ["Open receivables", fmtMoney(openAr)],
                ["Notes", c.notes],
              ]}
            />
          </Card>
          <Card title="Sales orders" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Date</th>
                  <th>Customer PO</th>
                  <th>Status</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/orders/${o.id}`} className="font-medium text-brand hover:underline">
                        {o.number}
                      </Link>
                    </td>
                    <td>{fmtDate(o.orderDate)}</td>
                    <td>{o.customerPo}</td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="num">{fmtMoney(o.subtotal)}</td>
                  </tr>
                ))}
                {!orders.length ? (
                  <tr>
                    <td colSpan={5} className="text-ink-3">
                      No orders yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Quotes" padded={false}>
              <table className="data">
                <tbody>
                  {qs.map((q) => (
                    <tr key={q.id}>
                      <td>
                        <Link href={`/quotes/${q.id}`} className="font-medium text-brand hover:underline">
                          {q.number}
                        </Link>
                      </td>
                      <td>{fmtDate(q.quoteDate)}</td>
                      <td>
                        <StatusBadge status={q.status} />
                      </td>
                      <td className="num">{fmtMoney(q.subtotal)}</td>
                    </tr>
                  ))}
                  {!qs.length ? (
                    <tr>
                      <td className="text-ink-3">No quotes yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </Card>
            <Card title="Invoices" padded={false}>
              <table className="data">
                <tbody>
                  {invs.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Link href={`/invoices/${i.id}`} className="font-medium text-brand hover:underline">
                          {i.number}
                        </Link>
                      </td>
                      <td>{fmtDate(i.dueDate)}</td>
                      <td>
                        <StatusBadge status={i.status} />
                      </td>
                      <td className="num">{fmtMoney(i.total)}</td>
                    </tr>
                  ))}
                  {!invs.length ? (
                    <tr>
                      <td className="text-ink-3">No invoices yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </Card>
          </div>
        </div>
        <div className="space-y-4">
          <ContactsCard partyType="customer" partyId={c.id} rows={cts} />
          <ActivityCard partyType="customer" partyId={c.id} rows={acts} />
        </div>
      </div>
    </>
  );
}
