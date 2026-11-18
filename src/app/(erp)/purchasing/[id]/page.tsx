import Link from "next/link";
import { uuidOr404 } from "@/lib/ids";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { items, purchaseOrderLines, purchaseOrders, receiptLines, receipts, vendorBills, vendors, workOrders } from "@/lib/db/schema";
import { pickLocations } from "@/lib/pick";
import { Card, DL, PageHeader, StatusBadge } from "@/components/ui/page";
import { Button, LinkButton } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/fields";
import { billPoAction, poStatusAction, receivePoAction } from "@/modules/purchasing/actions";
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
    .innerJoin(items, eq(items.id, purchaseOrderLines.itemId))
    .where(eq(purchaseOrderLines.poId, po.id))
    .orderBy(asc(purchaseOrderLines.lineNo));
  const [rcpts, bills, locs, wo] = await Promise.all([
    db.select({ r: receipts, l: receiptLines, sku: items.sku }).from(receiptLines).innerJoin(receipts, eq(receipts.id, receiptLines.receiptId)).innerJoin(items, eq(items.id, receiptLines.itemId)).where(eq(receipts.poId, po.id)).orderBy(desc(receipts.receivedAt)),
    db.select().from(vendorBills).where(eq(vendorBills.poId, po.id)),
    pickLocations(db, ctx.orgId),
    po.workOrderId ? db.select().from(workOrders).where(eq(workOrders.id, po.workOrderId)).then((r) => r[0]) : Promise.resolve(undefined),
  ]);
  const receivable = ["sent", "confirmed", "partially_received"].includes(po.status) && lines.some((l) => Number(l.l.qty) - Number(l.l.qtyReceived) > 0);
  const billable = lines.some((l) => Number(l.l.qtyReceived) - Number(l.l.qtyBilled) > 0);
  const stockLocs = locs.filter((l) => l.type !== "wip");
  return (
    <>
      <PageHeader
        title={po.number}
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
            {po.status === "draft" ? (
              <form action={poStatusAction}>
                <input type="hidden" name="id" value={po.id} />
                <input type="hidden" name="status" value="sent" />
                <Button type="submit">Mark sent</Button>
              </form>
            ) : null}
            {["draft", "sent"].includes(po.status) ? (
              <form action={poStatusAction}>
                <input type="hidden" name="id" value={po.id} />
                <input type="hidden" name="status" value="cancelled" />
                <Button type="submit" variant="danger">
                  Cancel
                </Button>
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
                  <th className="num">Qty</th>
                  <th className="num">Received</th>
                  <th className="num">Billed</th>
                  <th>Expected</th>
                  <th className="num">Unit cost</th>
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
                    <td className="num">{fmtQty(l.qtyReceived)}</td>
                    <td className="num">{fmtQty(l.qtyBilled)}</td>
                    <td>{fmtDate(l.expectedDate)}</td>
                    <td className="num">{fmtMoney(l.unitCost)}</td>
                    <td className="num">{fmtMoney(Number(l.qty) * Number(l.unitCost))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8} className="text-right font-medium">
                    Total
                  </td>
                  <td className="num font-semibold">{fmtMoney(po.subtotal)}</td>
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
                      <th className="w-40">Lot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines
                      .filter((l) => Number(l.l.qty) - Number(l.l.qtyReceived) > 0)
                      .map(({ l, sku }, i) => {
                        const open = Number(l.qty) - Number(l.qtyReceived);
                        return (
                          <tr key={l.id}>
                            <td>
                              <input type="hidden" name={`lines[${i}][poLineId]`} value={l.id} />
                              {sku} <span className="text-ink-3">{l.description}</span>
                            </td>
                            <td className="num">{fmtQty(open)}</td>
                            <td>
                              <Input name={`lines[${i}][qty]`} type="number" step="0.0001" min="0" max={open} defaultValue={open} className="text-right" />
                            </td>
                            <td>
                              <Input name={`lines[${i}][lotNumber]`} placeholder="Lot / heat #" />
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
                    <span className="mb-1 block text-xs text-ink-2">Packing slip #</span>
                    <Input name="packingSlip" />
                  </div>
                  <label className="flex items-center gap-2 pb-2 text-sm">
                    <input type="checkbox" name="bill" /> Also record the vendor bill now
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}
        </div>
        <div className="space-y-4">
          <Card title="Vendor">
            <DL
              rows={[
                ["Vendor", <Link key="v" href={`/vendors/${vendor.id}`} className="text-brand hover:underline">{vendor.name}</Link>],
                ["Vendor ref", po.vendorRef],
                ["Terms", `Net ${vendor.termsDays}`],
                ["Work order", wo ? <Link key="w" href={`/work-orders/${wo.id}`} className="text-brand hover:underline">{wo.number}</Link> : "—"],
                ["Notes", po.notes],
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
                <Input name="tax" type="number" step="0.01" placeholder="Tax / freight" />
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
        </div>
      </div>
    </>
  );
}
