import Link from "next/link";
import { uuidOr404 } from "@/lib/ids";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { customers, invoices, items, orderChanges, salesOrderLines, salesOrders, shipments, users, workOrders } from "@/lib/db/schema";
import { pickLocations } from "@/lib/pick";
import { Card, DL, PageHeader, StatusBadge } from "@/components/ui/page";
import { Button, LinkButton } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/fields";
import { cancelOrderAction, changeLineAction, confirmOrderAction } from "@/modules/sales/actions";
import { createWorkOrdersForOrderAction } from "@/modules/production/actions";
import { shipInFullAction } from "@/modules/shipping/actions";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty } from "@/lib/money";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [row] = await db
    .select({ o: salesOrders, customer: customers })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(salesOrders.id, id), eq(salesOrders.orgId, ctx.orgId)));
  if (!row) notFound();
  const { o, customer } = row;
  const lines = await db
    .select({ l: salesOrderLines, sku: items.sku, itemType: items.type })
    .from(salesOrderLines)
    .innerJoin(items, eq(items.id, salesOrderLines.itemId))
    .where(eq(salesOrderLines.orderId, o.id))
    .orderBy(asc(salesOrderLines.lineNo));
  const lineIds = lines.map((l) => l.l.id);
  const [wos, shs, invs, changes, locs] = await Promise.all([
    lineIds.length
      ? db.select({ w: workOrders, sku: items.sku }).from(workOrders).innerJoin(items, eq(items.id, workOrders.itemId)).where(inArray(workOrders.salesOrderLineId, lineIds)).orderBy(desc(workOrders.createdAt))
      : Promise.resolve([]),
    db.select().from(shipments).where(eq(shipments.orderId, o.id)).orderBy(desc(shipments.createdAt)),
    db.select().from(invoices).where(eq(invoices.orderId, o.id)).orderBy(desc(invoices.issueDate)),
    db.select({ c: orderChanges, userName: users.name }).from(orderChanges).leftJoin(users, eq(users.id, orderChanges.userId)).where(eq(orderChanges.orderId, o.id)).orderBy(desc(orderChanges.createdAt)),
    pickLocations(db, ctx.orgId),
  ]);
  const open = !["draft", "cancelled", "closed", "shipped", "invoiced"].includes(o.status);
  const makeLinesWithoutWo = lines.filter((l) => l.itemType === "make" && !wos.some((w) => w.w.salesOrderLineId === l.l.id));
  const anyToShip = lines.some((l) => Number(l.l.qty) - Number(l.l.qtyShipped) > 0);
  const stockLocs = locs.filter((l) => l.type === "stock" || l.type === "shipping" || l.type === "staging");

  return (
    <>
      <PageHeader
        title={o.number}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={o.status} />
            <span>
              {customer.name}
              {o.customerPo ? ` · PO ${o.customerPo}` : ""}
              {o.program ? ` · program ${o.program}` : ""} · promised {fmtDate(o.promisedDate) || "—"}
            </span>
          </span>
        }
        crumbs={[{ href: "/orders", label: "Sales orders" }]}
        actions={
          <>
            <LinkButton href={`/print/order/${o.id}`} variant="secondary">
              Acknowledgement
            </LinkButton>
            {o.status === "draft" ? (
              <form action={confirmOrderAction}>
                <input type="hidden" name="id" value={o.id} />
                <Button type="submit">Confirm order</Button>
              </form>
            ) : null}
            {open && makeLinesWithoutWo.length ? (
              <form action={createWorkOrdersForOrderAction}>
                <input type="hidden" name="orderId" value={o.id} />
                <Button type="submit" variant="secondary">
                  Create {makeLinesWithoutWo.length} work order{makeLinesWithoutWo.length > 1 ? "s" : ""}
                </Button>
              </form>
            ) : null}
            {open && anyToShip ? (
              <LinkButton href={`/shipments/new?orderId=${o.id}`} variant="secondary">
                Pack a shipment
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
                  <th>Item</th>
                  <th>Description</th>
                  <th className="num">Qty</th>
                  <th className="num">Shipped</th>
                  <th className="num">Invoiced</th>
                  <th>Promised</th>
                  <th className="num">Price</th>
                  <th className="num">Ext.</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(({ l, sku }) => (
                  <tr key={l.id}>
                    <td className="text-ink-3">{l.lineNo}</td>
                    <td>
                      <Link href={`/items/${l.itemId}`} className="text-brand hover:underline">
                        {sku}
                      </Link>
                    </td>
                    <td>{l.description}</td>
                    <td className="num">{fmtQty(l.qty)}</td>
                    <td className="num">{fmtQty(l.qtyShipped)}</td>
                    <td className="num">{fmtQty(l.qtyInvoiced)}</td>
                    <td>{fmtDate(l.promisedDate)}</td>
                    <td className="num">{fmtMoney(l.unitPrice)}</td>
                    <td className="num">{fmtMoney(Number(l.qty) * Number(l.unitPrice))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8} className="text-right font-medium">
                    Total
                  </td>
                  <td className="num font-semibold">{fmtMoney(o.subtotal)}</td>
                </tr>
              </tfoot>
            </table>
          </Card>
          <div className="grid gap-4 md:grid-cols-3">
            <Card title="Work orders" padded={false}>
              <table className="data">
                <tbody>
                  {wos.map(({ w, sku }) => (
                    <tr key={w.id}>
                      <td>
                        <Link href={`/work-orders/${w.id}`} className="font-medium text-brand hover:underline">
                          {w.number}
                        </Link>
                        <div className="text-xs text-ink-3">
                          {sku} × {fmtQty(w.qty)}
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={w.status} />
                      </td>
                    </tr>
                  ))}
                  {!wos.length ? (
                    <tr>
                      <td className="text-ink-3">None yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </Card>
            <Card title="Shipments" padded={false}>
              <table className="data">
                <tbody>
                  {shs.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link href={`/shipments/${s.id}`} className="font-medium text-brand hover:underline">
                          {s.number}
                        </Link>
                        <div className="text-xs text-ink-3">{s.shippedAt ? fmtDateTime(s.shippedAt) : "packing"}</div>
                      </td>
                      <td>
                        <StatusBadge status={s.status} />
                      </td>
                    </tr>
                  ))}
                  {!shs.length ? (
                    <tr>
                      <td className="text-ink-3">None yet.</td>
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
                        <div className="text-xs text-ink-3">{fmtMoney(i.total)}</div>
                      </td>
                      <td>
                        <StatusBadge status={i.status} />
                      </td>
                    </tr>
                  ))}
                  {!invs.length ? (
                    <tr>
                      <td className="text-ink-3">None yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </Card>
          </div>
          {changes.length ? (
            <Card title="Change log">
              <ul className="space-y-1 text-sm">
                {changes.map(({ c, userName }) => (
                  <li key={c.id}>
                    <span className="text-xs text-ink-3">
                      {fmtDateTime(c.createdAt)} · {userName ?? "system"}
                    </span>{" "}
                    {c.description}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
        <div className="space-y-4">
          <Card title="Summary">
            <DL
              rows={[
                ["Customer", <Link key="c" href={`/customers/${customer.id}`} className="text-brand hover:underline">{customer.name}</Link>],
                ["Ordered", fmtDate(o.orderDate)],
                ["Promised", fmtDate(o.promisedDate)],
                ["Quote", o.quoteId ? <Link key="q" href={`/quotes/${o.quoteId}`} className="text-brand hover:underline">open quote</Link> : "—"],
                ["Notes", o.notes],
              ]}
            />
          </Card>
          {open && anyToShip ? (
            <Card title="Ship everything open">
              <ActionForm action={shipInFullAction} className="space-y-2">
                <input type="hidden" name="orderId" value={o.id} />
                <Select name="locationId" required defaultValue={stockLocs[0]?.id ?? ""}>
                  {stockLocs.map((l) => (
                    <option key={l.id} value={l.id}>
                      From {l.code} · {l.name}
                    </option>
                  ))}
                </Select>
                <div className="flex gap-2">
                  <Input name="carrier" placeholder="Carrier" />
                  <Input name="tracking" placeholder="Tracking #" />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="invoice" defaultChecked /> Invoice it too
                </label>
                <SubmitButton className="w-full">Ship in full</SubmitButton>
              </ActionForm>
              <p className="mt-2 text-xs text-ink-3">Stock leaves at average cost; COGS, inventory, receivables and revenue post in the same transaction.</p>
            </Card>
          ) : null}
          {open ? (
            <Card title="Change a line">
              <ActionForm action={changeLineAction} className="space-y-2">
                <input type="hidden" name="orderId" value={o.id} />
                <Select name="lineId" required defaultValue="">
                  <option value="">Line…</option>
                  {lines.map(({ l, sku }) => (
                    <option key={l.id} value={l.id}>
                      {l.lineNo} · {sku}
                    </option>
                  ))}
                </Select>
                <div className="grid grid-cols-3 gap-2">
                  <Input name="qty" type="number" step="0.0001" placeholder="New qty" />
                  <Input name="unitPrice" type="number" step="0.0001" placeholder="New price" />
                  <Input name="promisedDate" type="date" />
                </div>
                <Input name="reason" placeholder="Reason (required, logged)" required />
                <SubmitButton variant="secondary" className="w-full">
                  Apply change
                </SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
          {open || o.status === "draft" ? (
            <Card title="Cancel">
              <ActionForm action={cancelOrderAction} className="flex gap-2">
                <input type="hidden" name="id" value={o.id} />
                <Input name="reason" placeholder="Reason" required />
                <SubmitButton variant="danger">Cancel order</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
