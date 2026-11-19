import Link from "@/components/ui/link";
import { uuidOr404 } from "@/lib/ids";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { attachments, customers, invoices, items, orderChanges, salesOrderLines, salesOrders, shipments, users, workOrderOperations, workOrders } from "@/lib/db/schema";
import { pickItems, pickLocations } from "@/lib/pick";
import { Badge, Card, DL, PageHeader, StatusBadge } from "@/components/ui/page";
import { Button, LinkButton } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/fields";
import { AttachmentsCard } from "@/components/forms/attachments";
import { AddressFields } from "@/components/forms/address-fields";
import { addLineAction, cancelLineAction, cancelOrderAction, changeLineAction, confirmOrderFormAction, deleteOrderAction, updateOrderHeaderAction } from "@/modules/sales/actions";
import { DeleteCard } from "@/components/forms/delete-card";
import { lineAmount, openReceivables } from "@/modules/sales/service";
import { createWorkOrdersForOrderAction } from "@/modules/production/actions";
import { shipInFullAction } from "@/modules/shipping/actions";
import { formatAddress } from "@/lib/forms";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, today } from "@/lib/money";

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
  const [wos, shs, invs, changes, locs, docs, itemList, arOpen] = await Promise.all([
    lineIds.length
      ? db.select({ w: workOrders, sku: items.sku }).from(workOrders).innerJoin(items, eq(items.id, workOrders.itemId)).where(inArray(workOrders.salesOrderLineId, lineIds)).orderBy(desc(workOrders.createdAt))
      : Promise.resolve([]),
    db.select().from(shipments).where(eq(shipments.orderId, o.id)).orderBy(desc(shipments.createdAt)),
    db.select().from(invoices).where(eq(invoices.orderId, o.id)).orderBy(desc(invoices.issueDate)),
    db.select({ c: orderChanges, userName: users.name }).from(orderChanges).leftJoin(users, eq(users.id, orderChanges.userId)).where(eq(orderChanges.orderId, o.id)).orderBy(desc(orderChanges.createdAt)),
    pickLocations(db, ctx.orgId),
    db.select().from(attachments).where(and(eq(attachments.orgId, ctx.orgId), eq(attachments.entityType, "order"), eq(attachments.entityId, o.id))),
    pickItems(db, ctx.orgId),
    openReceivables(db, ctx.orgId, customer.id),
  ]);
  const opStats = wos.length
    ? await db
        .select({
          woId: workOrderOperations.workOrderId,
          total: sql<number>`count(*)`.mapWith(Number),
          done: sql<number>`count(*) filter (where ${workOrderOperations.status} = 'complete')`.mapWith(Number),
        })
        .from(workOrderOperations)
        .where(inArray(workOrderOperations.workOrderId, wos.map((x) => x.w.id)))
        .groupBy(workOrderOperations.workOrderId)
    : [];
  const open = !["draft", "cancelled", "closed", "shipped", "invoiced"].includes(o.status);
  const makeLinesWithoutWo = lines.filter((l) => l.itemType === "make" && !wos.some((w) => w.w.salesOrderLineId === l.l.id) && Number(l.l.qty) - Number(l.l.qtyCancelled) > 0);
  const openQty = (l: typeof salesOrderLines.$inferSelect) => Number(l.qty) - Number(l.qtyShipped) - Number(l.qtyCancelled);
  const anyToShip = lines.some((l) => openQty(l.l) > 0);
  const stockLocs = locs.filter((l) => l.type === "stock" || l.type === "shipping" || l.type === "staging");
  const creditWarning = Number(customer.creditLimit) > 0 && arOpen + Number(o.subtotal) > Number(customer.creditLimit);

  return (
    <>
      <PageHeader
        title={o.number}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={o.status} />
            {o.holdReason ? <Badge tone="warn">on hold</Badge> : null}
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
              <LinkButton href={`/orders/${o.id}/edit`} variant="secondary">
                Edit
              </LinkButton>
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
      {o.status === "draft" ? (
        <Card className="mb-4">
          <ActionForm action={confirmOrderFormAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="id" value={o.id} />
            <span className="text-sm text-ink-2">
              Draft order.
              {o.holdReason ? <span className="ml-1 text-warn">{o.holdReason}.</span> : creditWarning ? <span className="ml-1 text-warn">Confirming would exceed the credit limit ({fmtMoney(customer.creditLimit)}; {fmtMoney(arOpen)} open).</span> : null}
            </span>
            {(o.holdReason || creditWarning || customer.creditHold) && ctx.role === "owner" ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="overrideCredit" /> Override credit check
              </label>
            ) : null}
            <SubmitButton>Confirm order</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
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
                  <th className="num">Open</th>
                  <th className="num">Invoiced</th>
                  <th>Promised</th>
                  <th className="num">Price</th>
                  <th className="num">Disc</th>
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
                    <td>
                      {l.description}
                      {l.notes ? <div className="text-xs text-ink-3">{l.notes}</div> : null}
                    </td>
                    <td className="num">{fmtQty(l.qty)}</td>
                    <td className="num">{fmtQty(l.qtyShipped)}</td>
                    <td className="num">
                      {fmtQty(Math.max(0, openQty(l)))}
                      {Number(l.qtyCancelled) > 0 ? <div className="text-xs text-ink-3">{fmtQty(l.qtyCancelled)} cancelled</div> : null}
                    </td>
                    <td className="num">{fmtQty(l.qtyInvoiced)}</td>
                    <td>{fmtDate(l.promisedDate)}</td>
                    <td className="num">{fmtMoney(l.unitPrice)}</td>
                    <td className="num">{Number(l.discountPct) ? `${Number(l.discountPct)}%` : ""}</td>
                    <td className="num">{fmtMoney(lineAmount(Number(l.qty) - Number(l.qtyCancelled), Number(l.unitPrice), Number(l.discountPct)))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={10} className="text-right font-medium">
                    Lines{Number(o.discountPct) ? ` · ${Number(o.discountPct)}% order discount applies on invoice` : ""}
                    {Number(o.freight) ? ` · freight ${fmtMoney(o.freight)} to invoice` : ""}
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
                  {wos.map(({ w, sku }) => {
                    const st = opStats.find((x) => x.woId === w.id);
                    const pct = w.status === "complete" || w.status === "closed" ? 100 : Number(w.qty) > 0 ? Math.min(100, Math.round((Number(w.qtyComplete) / Number(w.qty)) * 100)) : 0;
                    const opPct = st?.total ? Math.round((st.done / st.total) * 100) : 0;
                    const late = w.dueDate && w.dueDate < today() && !["complete", "closed", "cancelled"].includes(w.status);
                    return (
                      <tr key={w.id}>
                        <td>
                          <Link href={`/work-orders/${w.id}`} className="font-medium text-brand hover:underline">
                            {w.number}
                          </Link>
                          <div className="text-xs text-ink-3">
                            {sku} × {fmtQty(w.qty)}
                            {w.dueDate ? <span className={late ? " text-bad" : ""}> · due {fmtDate(w.dueDate)}</span> : null}
                          </div>
                          <div className="mt-1.5 h-1 w-full max-w-40 rounded bg-paper">
                            <div className="h-1 rounded bg-brand" style={{ width: `${Math.max(pct, opPct)}%` }} />
                          </div>
                        </td>
                        <td className="whitespace-nowrap">
                          <StatusBadge status={w.status} />
                          <div className="mt-1 text-xs text-ink-3">
                            {fmtQty(w.qtyComplete)} of {fmtQty(w.qty)} done
                            {st?.total ? ` · ${st.done}/${st.total} ops` : ""}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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
          {open ? (
            <div className="grid gap-4 md:grid-cols-2">
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
                  <div className="grid grid-cols-4 gap-2">
                    <Input name="qty" type="number" step="0.0001" placeholder="Qty" />
                    <Input name="unitPrice" type="number" step="0.0001" placeholder="Price" />
                    <Input name="discountPct" type="number" step="0.01" placeholder="Disc %" />
                    <Input name="promisedDate" type="date" />
                  </div>
                  <Input name="reason" placeholder="Reason (required, logged)" required />
                  <SubmitButton variant="secondary" className="w-full">
                    Apply change
                  </SubmitButton>
                </ActionForm>
              </Card>
              <Card title="Add a line">
                <ActionForm action={addLineAction} className="space-y-2">
                  <input type="hidden" name="orderId" value={o.id} />
                  <Select name="itemId" required defaultValue="">
                    <option value="">Item…</option>
                    {itemList.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.sku} · {i.name}
                      </option>
                    ))}
                  </Select>
                  <div className="grid grid-cols-4 gap-2">
                    <Input name="qty" type="number" step="0.0001" placeholder="Qty" required />
                    <Input name="unitPrice" type="number" step="0.0001" placeholder="Price list" />
                    <Input name="discountPct" type="number" step="0.01" placeholder="Disc %" />
                    <Input name="promisedDate" type="date" />
                  </div>
                  <Input name="reason" placeholder="Reason (logged)" />
                  <SubmitButton variant="secondary" className="w-full">
                    Add line
                  </SubmitButton>
                </ActionForm>
              </Card>
            </div>
          ) : null}
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
                ["Requested", fmtDate(o.requestedDate)],
                ["Promised", fmtDate(o.promisedDate)],
                ["Terms", `Net ${o.termsDays ?? customer.termsDays}`],
                ["Ship via", o.shipVia],
                ["Ship to", o.shipTo ? formatAddress(o.shipTo).join(", ") : null],
                ["Sales rep", o.salesRep],
                ["Quote", o.quoteId ? <Link key="q" href={`/quotes/${o.quoteId}`} className="text-brand hover:underline">open quote</Link> : "—"],
                ["Notes", o.notes],
                ["Internal", o.internalNotes],
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
                  <Input name="carrier" placeholder="Carrier" defaultValue={o.shipVia ?? ""} />
                  <Input name="tracking" placeholder="Tracking #" />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="invoice" defaultChecked /> Invoice it too
                </label>
                <SubmitButton className="w-full">Ship in full</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
          {open || o.status === "draft" ? (
            <Card title="Update header">
              <ActionForm action={updateOrderHeaderAction} className="space-y-2">
                <input type="hidden" name="orderId" value={o.id} />
                <div className="grid grid-cols-2 gap-2">
                  <Input name="customerPo" placeholder="Customer PO" defaultValue={o.customerPo ?? ""} />
                  <Input name="program" placeholder="Program" defaultValue={o.program ?? ""} />
                  <Input name="requestedDate" type="date" defaultValue={o.requestedDate ?? ""} />
                  <Input name="promisedDate" type="date" defaultValue={o.promisedDate ?? ""} />
                  <Input name="shipVia" placeholder="Ship via" defaultValue={o.shipVia ?? ""} />
                  <Input name="freight" type="number" step="0.01" placeholder="Freight" defaultValue={Number(o.freight) ? String(o.freight) : ""} />
                </div>
                <AddressFields prefix="shipTo" value={o.shipTo} title="Ship to" />
                <Textarea name="notes" placeholder="Notes" defaultValue={o.notes ?? ""} />
                <Input name="reason" placeholder={o.status === "draft" ? "Reason (optional)" : "Reason (logged)"} />
                <SubmitButton variant="secondary" className="w-full">
                  Save header
                </SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
          {open ? (
            <Card title="Cancel a line">
              <ActionForm action={cancelLineAction} className="space-y-2">
                <input type="hidden" name="orderId" value={o.id} />
                <Select name="lineId" required defaultValue="">
                  <option value="">Line…</option>
                  {lines
                    .filter(({ l }) => openQty(l) > 0)
                    .map(({ l, sku }) => (
                      <option key={l.id} value={l.id}>
                        {l.lineNo} · {sku} · {fmtQty(openQty(l))} open
                      </option>
                    ))}
                </Select>
                <Input name="reason" placeholder="Reason (logged)" required />
                <SubmitButton variant="danger" className="w-full">
                  Cancel open quantity
                </SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
          {open || o.status === "draft" ? (
            <Card title="Cancel order">
              <ActionForm action={cancelOrderAction} className="flex gap-2">
                <input type="hidden" name="id" value={o.id} />
                <Input name="reason" placeholder="Reason" required />
                <SubmitButton variant="danger">Cancel</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
          <AttachmentsCard entityType="order" entityId={o.id} rows={docs} returnTo={`/orders/${o.id}`} />
          {!["partially_shipped", "shipped", "invoiced", "closed"].includes(o.status) && !shs.length && !invs.length && !wos.length ? <DeleteCard action={deleteOrderAction} id={o.id} label={o.number} /> : null}
        </div>
      </div>
    </>
  );
}
