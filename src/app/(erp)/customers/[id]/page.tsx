import Link from "@/components/ui/link";
import { uuidOr404 } from "@/lib/ids";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { activities, contacts, customerAddresses, customerPrices, customers, invoices, items, quotes, salesOrders } from "@/lib/db/schema";
import { Badge, Card, DL, PageHeader, StatusBadge } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/fields";
import { ActivityCard, ContactsCard } from "@/components/forms/party-side";
import { AddressFields } from "@/components/forms/address-fields";
import { CustomerPriceListCard } from "@/components/forms/price-list";
import { deleteCustomerAddressAction, saveCustomerAddressAction } from "@/modules/parties/actions";
import { pickItems } from "@/lib/pick";
import { formatAddress } from "@/lib/forms";
import { fmtDate, fmtMoney } from "@/lib/money";

function addr(a?: { line1?: string; city?: string; state?: string; postalCode?: string } | null) {
  if (!a) return "—";
  return [a.line1, [a.city, a.state].filter(Boolean).join(", "), a.postalCode].filter(Boolean).join(" · ");
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [c] = await db.select().from(customers).where(and(eq(customers.id, id), eq(customers.orgId, ctx.orgId)));
  if (!c) notFound();
  const [orders, qs, invs, cts, acts, addrs, prices, itemList] = await Promise.all([
    db.select().from(salesOrders).where(eq(salesOrders.customerId, c.id)).orderBy(desc(salesOrders.orderDate)).limit(20),
    db.select().from(quotes).where(eq(quotes.customerId, c.id)).orderBy(desc(quotes.quoteDate)).limit(20),
    db.select().from(invoices).where(eq(invoices.customerId, c.id)).orderBy(desc(invoices.issueDate)).limit(20),
    db.select().from(contacts).where(and(eq(contacts.partyType, "customer"), eq(contacts.partyId, c.id))),
    db.select().from(activities).where(and(eq(activities.partyType, "customer"), eq(activities.partyId, c.id))).orderBy(desc(activities.at)).limit(20),
    db.select().from(customerAddresses).where(eq(customerAddresses.customerId, c.id)),
    db.select({ cp: customerPrices, sku: items.sku, name: items.name }).from(customerPrices).innerJoin(items, eq(items.id, customerPrices.itemId)).where(and(eq(customerPrices.orgId, ctx.orgId), eq(customerPrices.customerId, c.id))),
    pickItems(db, ctx.orgId),
  ]);
  const openAr = invs.filter((i) => i.status === "issued").reduce((s, i) => s + Number(i.total) - Number(i.amountPaid), 0);
  const overdue = invs.filter((i) => i.status === "issued" && i.dueDate < new Date().toISOString().slice(0, 10)).reduce((s, i) => s + Number(i.total) - Number(i.amountPaid), 0);
  const ytd = invs.filter((i) => i.status !== "void" && i.kind === "invoice" && i.issueDate.slice(0, 4) === new Date().toISOString().slice(0, 4)).reduce((s, i) => s + Number(i.total), 0);
  return (
    <>
      <PageHeader
        title={c.name}
        description={
          <span className="flex items-center gap-2">
            <span>
              {c.code} · Net {c.termsDays}
              {c.taxExempt ? " · tax exempt" : ""}
              {c.salesRep ? ` · rep ${c.salesRep}` : ""}
            </span>
            {c.creditHold ? <Badge tone="bad">credit hold</Badge> : null}
            {!c.active ? <Badge>inactive</Badge> : null}
          </span>
        }
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
                ["Website", c.website],
                ["Industry", c.industry],
                ["Billing", addr(c.billingAddress)],
                ["Shipping", addr(c.shippingAddress)],
                ["Ship via", c.shipVia],
                ["Standard discount", Number(c.discountPct) ? `${Number(c.discountPct)}%` : null],
                ["Tax exemption", c.taxExempt ? c.taxCertNo || "exempt" : "taxable"],
                ["Credit limit", Number(c.creditLimit) ? fmtMoney(c.creditLimit) : "none"],
                ["Open receivables", <span key="ar">{fmtMoney(openAr)}{overdue ? <span className="ml-1 text-bad">({fmtMoney(overdue)} overdue)</span> : null}</span>],
                ["Invoiced this year", fmtMoney(ytd)],
                ["Notes", c.notes],
              ]}
            />
          </Card>
          <Card title="Ship-to addresses" padded={false}>
            <table className="data">
              <tbody>
                {addrs.map((a) => (
                  <tr key={a.id}>
                    <td className="font-medium">
                      {a.label}
                      {a.isDefault ? <span className="ml-1 text-xs text-ink-3">default</span> : null}
                    </td>
                    <td>{formatAddress(a.address).join(", ")}</td>
                    <td className="text-right">
                      <form action={deleteCustomerAddressAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="customerId" value={c.id} />
                        <button className="text-xs text-ink-3 hover:text-bad" type="submit">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {!addrs.length ? (
                  <tr>
                    <td colSpan={3} className="text-ink-3">
                      Only the default shipping address above. Add plants, drop-ship or job-site addresses here.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <ActionForm action={saveCustomerAddressAction} className="space-y-2 border-t border-line p-3">
              <input type="hidden" name="customerId" value={c.id} />
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-48">
                  <span className="mb-1 block text-xs text-ink-2">Label</span>
                  <Input name="label" placeholder="Plant 2, Dock B…" required />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input type="checkbox" name="isDefault" /> Default ship-to
                </label>
              </div>
              <AddressFields prefix="addr" title="Address" />
              <SubmitButton size="sm">Add address</SubmitButton>
            </ActionForm>
          </Card>
          <CustomerPriceListCard
            customerId={c.id}
            returnTo={`/customers/${c.id}`}
            items={itemList}
            rows={prices.map((p) => ({ id: p.cp.id, itemId: p.cp.itemId, sku: p.sku, name: p.name, minQty: Number(p.cp.minQty), unitPrice: Number(p.cp.unitPrice), validFrom: p.cp.validFrom, validTo: p.cp.validTo, customerId: p.cp.customerId }))}
            title="Customer prices"
          />
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
