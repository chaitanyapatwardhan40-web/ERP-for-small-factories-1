import Link from "@/components/ui/link";
import { uuidOr404 } from "@/lib/ids";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { attachments, items, orgs, purchaseOrderLines, purchaseOrders, receiptLines, receipts, users, vendorBills, vendors, workOrders } from "@/lib/db/schema";
import { pickLocations } from "@/lib/pick";
import { Badge, Card, DL, PageHeader, StatusBadge } from "@/components/ui/page";
import { Button, LinkButton } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/fields";
import { AttachmentsCard } from "@/components/forms/attachments";
import { CopyBox } from "@/components/ui/copy-box";
import { billPoAction, poStatusAction, receivePoAction } from "@/modules/purchasing/actions";
import { poEmailText, poTotal } from "@/modules/purchasing/service";
import { formatAddress } from "@/lib/forms";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, today } from "@/lib/money";

export default async function PoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [row] = await db
    .select({ po: purchaseOrders, vendor: vendors })
    .from(purchaseOrders)
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.orgId, ctx.orgId)));
  if (!row) notFound();
  const { po, vendor } = row;
  const lines = await db
    .select({ l: purchaseOrderLines, sku: items.sku })
    .from(purchaseOrderLines)
    .leftJoin(items, eq(items.id, purchaseOrderLines.itemId))
    .where(eq(purchaseOrderLines.poId, po.id))
    .orderBy(asc(purchaseOrderLines.lineNo));
  const [rcpts, bills, locs, wo, docs, org, buyer] = await Promise.all([
    db.select({ r: receipts, l: receiptLines, sku: items.sku }).from(receiptLines).innerJoin(receipts, eq(receipts.id, receiptLines.receiptId)).innerJoin(items, eq(items.id, receiptLines.itemId)).where(eq(receipts.poId, po.id)).orderBy(desc(receipts.receivedAt)),
    db.select().from(vendorBills).where(eq(vendorBills.poId, po.id)),
    pickLocations(db, ctx.orgId),
    po.workOrderId ? db.select().from(workOrders).where(eq(workOrders.id, po.workOrderId)).then((r) => r[0]) : Promise.resolve(undefined),
    db.select().from(attachments).where(and(eq(attachments.orgId, ctx.orgId), eq(attachments.entityType, "po"), eq(attachments.entityId, po.id))),
    db.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, ctx.orgId)).then((r) => r[0]),
    po.buyerId ? db.select({ name: users.name }).from(users).where(eq(users.id, po.buyerId)).then((r) => r[0]) : Promise.resolve(undefined),
  ]);
  const openLines = lines.filter(({ l }) => l.lineType === "item" && Number(l.qty) - Number(l.qtyReceived) - Number(l.qtyCancelled) > 0);
  const receivable = ["sent", "confirmed", "partially_received"].includes(po.status) && openLines.length > 0;
  const billable = lines.some(({ l }) => (l.lineType === "item" ? Number(l.qtyReceived) - Number(l.qtyBilled) > 0 : Number(l.qty) - Number(l.qtyBilled) > 0));
  const editable = ["draft", "sent", "confirmed"].includes(po.status) && !lines.some(({ l }) => Number(l.qtyReceived) > 0 || Number(l.qtyBilled) > 0);
  const stockLocs = locs.filter((l) => l.type !== "wip");
  const billed = bills.filter((b) => b.status !== "void").reduce((s, b) => s + Number(b.total), 0);
  const email = poEmailText(
    po,
    vendor,
    lines.map(({ l }) => ({ lineNo: l.lineNo, description: l.description, vendorPartNo: l.vendorPartNo, qty: Number(l.qty), unitCost: Number(l.unitCost), expectedDate: l.expectedDate })),
    org?.name ?? "",
  );
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {po.number}
            {po.revision > 1 ? <Badge>rev {po.revision}</Badge> : null}
          </span>
        }
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={po.status} />
            <span>
              {vendor.name} · ordered {fmtDate(po.orderDate)} · expected {fmtDate(po.expectedDate) || "—"}
              {po.confirmedDate ? ` · confirmed for ${fmtDate(po.confirmedDate)}` : ""}
            </span>
          </span>
        }
        crumbs={[{ href: "/purchasing", label: "Purchase orders" }]}
        actions={
          <>
            <LinkButton href={`/print/po/${po.id}`} variant="secondary">
              Print PO
            </LinkButton>
            {editable ? (
              <LinkButton href={`/purchasing/${po.id}/edit`} variant="secondary">
                Edit
              </LinkButton>
            ) : null}
            {po.status === "draft" ? (
              <form action={poStatusAction}>
                <input type="hidden" name="id" value={po.id} />
                <input type="hidden" name="status" value="sent" />
                <Button type="submit">Mark sent</Button>
              </form>
            ) : null}
            {po.status === "received" && !billable ? (
              <form action={poStatusAction}>
                <input type="hidden" name="id" value={po.id} />
                <input type="hidden" name="status" value="closed" />
                <Button type="submit" variant="secondary">
                  Close
                </Button>
              </form>
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
                  <th>Vendor p/n</th>
                  <th className="num">Qty</th>
                  <th className="num">Received</th>
                  <th className="num">Open</th>
                  <th className="num">Billed</th>
                  <th>Need by</th>
                  <th className="num">Unit cost</th>
                  <th className="num">Ext.</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(({ l, sku }) => {
                  const open = Math.max(0, Number(l.qty) - Number(l.qtyReceived) - Number(l.qtyCancelled));
                  return (
                    <tr key={l.id}>
                      <td className="text-ink-3">{l.lineNo}</td>
                      <td>
                        {l.itemId ? (
                          <Link href={`/items/${l.itemId}`} className="text-brand hover:underline">
                            {sku}
                          </Link>
                        ) : (
                          <Badge>non-stock</Badge>
                        )}
                      </td>
                      <td>
                        {l.description}
                        {l.notes ? <div className="text-xs text-ink-3">{l.notes}</div> : null}
                      </td>
                      <td className="text-ink-3">{l.vendorPartNo}</td>
                      <td className="num">{fmtQty(l.qty)}</td>
                      <td className="num">{l.lineType === "item" ? fmtQty(l.qtyReceived) : "—"}</td>
                      <td className={`num ${l.lineType === "item" && open > 0 && ["sent", "confirmed", "partially_received"].includes(po.status) ? "font-medium" : "text-ink-3"}`}>
                        {l.lineType === "item" ? fmtQty(open) : "—"}
                        {Number(l.qtyCancelled) > 0 ? <div className="text-xs text-ink-3">{fmtQty(l.qtyCancelled)} cancelled</div> : null}
                      </td>
                      <td className="num">{fmtQty(l.qtyBilled)}</td>
                      <td>{fmtDate(l.expectedDate)}</td>
                      <td className="num">{fmtMoney(l.unitCost)}</td>
                      <td className="num">{fmtMoney(Number(l.qty) * Number(l.unitCost))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={10} className="text-right text-ink-2">
                    Lines
                  </td>
                  <td className="num">{fmtMoney(po.subtotal)}</td>
                </tr>
                {Number(po.freight) || Number(po.tax) ? (
                  <tr>
                    <td colSpan={10} className="text-right text-ink-2">
                      Freight {fmtMoney(po.freight)} · tax {fmtMoney(po.tax)}
                    </td>
                    <td className="num">{fmtMoney(Number(po.freight) + Number(po.tax))}</td>
                  </tr>
                ) : null}
                <tr>
                  <td colSpan={10} className="text-right font-medium">
                    Total
                  </td>
                  <td className="num font-semibold">{fmtMoney(poTotal(po))}</td>
                </tr>
              </tfoot>
            </table>
          </Card>
          {receivable ? (
            <Card title="Receive">
              <ActionForm action={receivePoAction} className="space-y-3">
                <input type="hidden" name="poId" value={po.id} />
                <table className="data">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">Open</th>
                      <th className="num w-32">Receive now</th>
                      <th className="w-36">Lot / heat #</th>
                      <th className="w-44">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openLines.map(({ l, sku }, i) => {
                      const open = Number(l.qty) - Number(l.qtyReceived) - Number(l.qtyCancelled);
                      return (
                        <tr key={l.id}>
                          <td>
                            <input type="hidden" name={`lines[${i}][poLineId]`} value={l.id} />
                            {sku} <span className="text-ink-3">{l.description}</span>
                          </td>
                          <td className="num">{fmtQty(open)}</td>
                          <td>
                            <Input name={`lines[${i}][qty]`} type="number" step="0.0001" min="0" defaultValue={open} className="text-right" />
                          </td>
                          <td>
                            <Input name={`lines[${i}][lotNumber]`} />
                          </td>
                          <td>
                            <Select name={`lines[${i}][locationId]`} defaultValue="">
                              <option value="">Default below</option>
                              {stockLocs.map((loc) => (
                                <option key={loc.id} value={loc.id}>
                                  {loc.code}
                                </option>
                              ))}
                            </Select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <span className="mb-1 block text-xs text-ink-2">Into location</span>
                    <Select name="locationId" required defaultValue={stockLocs[0]?.id ?? ""}>
                      {stockLocs.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code} · {l.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <span className="mb-1 block text-xs text-ink-2">Received on</span>
                    <Input name="receivedAt" type="date" defaultValue={today()} />
                  </div>
                  <div>
                    <span className="mb-1 block text-xs text-ink-2">Packing slip #</span>
                    <Input name="packingSlip" />
                  </div>
                  <label className="flex items-center gap-2 pb-2 text-sm">
                    <input type="checkbox" name="bill" /> Record the vendor bill now
                  </label>
                  <SubmitButton>Receive</SubmitButton>
                </div>
              </ActionForm>
            </Card>
          ) : null}
          {rcpts.length ? (
            <Card title="Receipts" padded={false}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>When</th>
                    <th>Item</th>
                    <th className="num">Qty</th>
                    <th>Lot</th>
                    <th>Slip</th>
                    <th>Inspection</th>
                  </tr>
                </thead>
                <tbody>
                  {rcpts.map(({ r, l, sku }) => (
                    <tr key={l.id}>
                      <td className="font-mono text-xs">{r.number}</td>
                      <td>{fmtDateTime(r.receivedAt)}</td>
                      <td>{sku}</td>
                      <td className="num">{fmtQty(l.qty)}</td>
                      <td>{l.lotNumber}</td>
                      <td>{r.packingSlip}</td>
                      <td>{l.inspectionStatus === "not_required" ? <span className="text-ink-3">—</span> : <StatusBadge status={l.inspectionStatus} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}
          {["sent", "confirmed"].includes(po.status) ? (
            <Card title="Send to vendor">
              <CopyBox subject={email.subject} body={email.body} mailto={vendor.email ?? undefined} />
            </Card>
          ) : null}
        </div>
        <div className="space-y-4">
          <Card title="Details">
            <DL
              rows={[
                ["Vendor", <Link key="v" href={`/vendors/${vendor.id}`} className="text-brand hover:underline">{vendor.name}</Link>],
                ["Vendor ref", po.vendorRef],
                ["Terms", `Net ${po.termsDays ?? vendor.termsDays}`],
                ["Ship via", po.shipVia],
                ["Ship to", po.shipTo ? <span key="st">{formatAddress(po.shipTo).join(", ")}</span> : null],
                ["Buyer", buyer?.name],
                ["Sent", po.sentAt ? fmtDateTime(po.sentAt) : null],
                ["Work order", wo ? <Link key="w" href={`/work-orders/${wo.id}`} className="text-brand hover:underline">{wo.number}</Link> : "—"],
                ["Billed", bills.length ? `${fmtMoney(billed)} of ${fmtMoney(poTotal(po))}` : null],
                ["Closed", po.closedAt ? `${fmtDateTime(po.closedAt)}${po.cancelReason ? ` · ${po.cancelReason}` : ""}` : null],
                ["Notes to vendor", po.notes],
                ["Internal notes", po.internalNotes],
              ]}
            />
          </Card>
          {["sent", "confirmed"].includes(po.status) ? (
            <Card title="Vendor confirmation">
              <form action={poStatusAction} className="space-y-2">
                <input type="hidden" name="id" value={po.id} />
                <input type="hidden" name="status" value="confirmed" />
                <Input name="confirmedDate" type="date" defaultValue={po.confirmedDate ?? po.expectedDate ?? today()} />
                <Input name="vendorRef" placeholder="Vendor order #" defaultValue={po.vendorRef ?? ""} />
                <Button type="submit" variant="secondary" className="w-full">
                  Record confirmation
                </Button>
              </form>
            </Card>
          ) : null}
          {billable ? (
            <Card title="Bill the received goods">
              <ActionForm action={billPoAction} className="space-y-2">
                <input type="hidden" name="poId" value={po.id} />
                <Input name="billDate" type="date" defaultValue={today()} required />
                <Input name="vendorRef" placeholder="Vendor invoice #" />
                <div className="grid grid-cols-2 gap-2">
                  <Input name="freight" type="number" step="0.01" placeholder="Freight" defaultValue={!bills.length && Number(po.freight) ? String(po.freight) : ""} />
                  <Input name="tax" type="number" step="0.01" placeholder="Tax" defaultValue={!bills.length && Number(po.tax) ? String(po.tax) : ""} />
                </div>
                <SubmitButton className="w-full">Create bill</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
          {bills.length ? (
            <Card title="Bills">
              <ul className="space-y-1 text-sm">
                {bills.map((b) => (
                  <li key={b.id} className="flex justify-between">
                    <Link href={`/bills/${b.id}`} className="text-brand hover:underline">
                      {b.number}
                    </Link>
                    <span>
                      {fmtMoney(b.total)} <StatusBadge status={b.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {["sent", "confirmed", "partially_received"].includes(po.status) && !receivable ? null : null}
          {["sent", "confirmed", "partially_received"].includes(po.status) ? (
            <Card title={po.status === "partially_received" ? "Close short" : "Cancel"}>
              <form action={poStatusAction} className="space-y-2">
                <input type="hidden" name="id" value={po.id} />
                <input type="hidden" name="status" value={po.status === "partially_received" ? "closed" : "cancelled"} />
                <Input name="reason" placeholder="Reason" required />
                <Button type="submit" variant="danger" className="w-full">
                  {po.status === "partially_received" ? "Close, cancel the open quantity" : "Cancel PO"}
                </Button>
              </form>
            </Card>
          ) : po.status === "draft" ? (
            <form action={poStatusAction}>
              <input type="hidden" name="id" value={po.id} />
              <input type="hidden" name="status" value="cancelled" />
              <Button type="submit" variant="danger" className="w-full">
                Cancel draft
              </Button>
            </form>
          ) : null}
          <AttachmentsCard entityType="po" entityId={po.id} rows={docs} returnTo={`/purchasing/${po.id}`} />
        </div>
      </div>
    </>
  );
}
