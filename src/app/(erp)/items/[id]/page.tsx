import Link from "@/components/ui/link";
import { uuidOr404 } from "@/lib/ids";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { attachments, bomLines, bomRevisions, items, orgs, routingOperations, vendors, workCenters } from "@/lib/db/schema";
import { Badge, Card, DL, PageHeader } from "@/components/ui/page";
import { LinkButton, Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/fields";
import { fmtMoney, fmtQty } from "@/lib/money";
import { activeBom, activeRouting, rollUpCost, whereUsed } from "@/modules/items/service";
import { onHand, stockByLocation } from "@/modules/inventory/service";
import { addBomLineAction, addOperationAction, newBomRevisionAction, recostItemAction, removeBomLineAction, removeOperationAction } from "@/modules/items/actions";
import { AttachmentsCard } from "@/components/forms/attachments";
import { vendorsForItem } from "@/modules/purchasing/service";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [item] = await db.select().from(items).where(and(eq(items.id, id), eq(items.orgId, ctx.orgId)));
  if (!item) notFound();
  const [org] = await db.select().from(orgs).where(eq(orgs.id, ctx.orgId));
  const overheadPct = org?.settings.overheadPct ?? 0;

  const bom = await activeBom(db, ctx.orgId, item.id);
  const lines = bom
    ? await db
        .select({ line: bomLines, sku: items.sku, name: items.name, type: items.type, standardCost: items.standardCost, componentId: items.id })
        .from(bomLines)
        .innerJoin(items, eq(items.id, bomLines.componentItemId))
        .where(eq(bomLines.bomRevisionId, bom.id))
        .orderBy(asc(bomLines.position))
    : [];
  const routing = await activeRouting(db, ctx.orgId, item.id);
  const ops = routing
    ? await db
        .select({ op: routingOperations, wc: workCenters.name, rate: workCenters.hourlyRate, vendorName: vendors.name })
        .from(routingOperations)
        .leftJoin(workCenters, eq(workCenters.id, routingOperations.workCenterId))
        .leftJoin(vendors, eq(vendors.id, routingOperations.outsideVendorId))
        .where(eq(routingOperations.routingId, routing.id))
        .orderBy(asc(routingOperations.seq))
    : [];
  const [wcs, vendorList, used, stock, total, docs, revs, suppliers] = await Promise.all([
    db.select().from(workCenters).where(and(eq(workCenters.orgId, ctx.orgId), eq(workCenters.active, true))).orderBy(asc(workCenters.code)),
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.orgId, ctx.orgId)).orderBy(asc(vendors.name)),
    whereUsed(db, ctx.orgId, item.id),
    stockByLocation(db, ctx.orgId, item.id),
    onHand(db, ctx.orgId, item.id),
    db.select().from(attachments).where(and(eq(attachments.orgId, ctx.orgId), eq(attachments.entityType, "item"), eq(attachments.entityId, item.id))).orderBy(asc(attachments.createdAt)),
    db.select().from(bomRevisions).where(and(eq(bomRevisions.orgId, ctx.orgId), eq(bomRevisions.itemId, item.id))).orderBy(asc(bomRevisions.createdAt)),
    vendorsForItem(db, ctx.orgId, item.id),
  ]);
  let cost = { material: 0, labor: 0, outside: 0, overhead: 0, total: 0 };
  try {
    cost = await rollUpCost(db, ctx.orgId, item.id, { overheadPct });
  } catch {
    /* loop or missing */
  }

  return (
    <>
      <PageHeader
        title={
          <span>
            {item.sku} <span className="font-normal text-ink-2">· {item.name}</span>
          </span>
        }
        description={
          <span className="flex items-center gap-2">
            <Badge tone={item.type === "make" ? "info" : "neutral"}>{item.type}</Badge>
            <span>Rev {item.revision}</span>
            {item.drawingNumber ? <span>· Drawing {item.drawingNumber}</span> : null}
            {item.status === "obsolete" ? <Badge tone="bad">obsolete</Badge> : null}
          </span>
        }
        crumbs={[{ href: "/items", label: "Items" }]}
        actions={
          <>
            {item.type === "make" ? (
              <LinkButton href={`/work-orders/new?itemId=${item.id}`} variant="secondary">
                New work order
              </LinkButton>
            ) : (
              <LinkButton href={`/purchasing/new?itemId=${item.id}`} variant="secondary">
                New PO
              </LinkButton>
            )}
            <LinkButton href={`/items/${item.id}/edit`}>Edit</LinkButton>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {item.type === "make" || item.type === "phantom" ? (
            <Card
              title={`Bill of materials ${bom ? `· rev ${bom.rev}` : ""}`}
              actions={
                <form action={newBomRevisionAction}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <Button variant="ghost" size="sm" type="submit">
                    New revision
                  </Button>
                </form>
              }
              padded={false}
            >
              <table className="data">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Component</th>
                    <th>Type</th>
                    <th className="num">Qty per</th>
                    <th className="num">Scrap %</th>
                    <th className="num">Unit cost</th>
                    <th className="num">Extended</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.line.id}>
                      <td className="text-ink-3">{i + 1}</td>
                      <td>
                        <Link href={`/items/${l.componentId}`} className="font-medium text-brand hover:underline">
                          {l.sku}
                        </Link>{" "}
                        <span className="text-ink-3">{l.name}</span>
                        {l.line.refDes ? <div className="text-xs text-ink-3">{l.line.refDes}</div> : null}
                        {l.line.notes ? <div className="text-xs text-ink-3">{l.line.notes}</div> : null}
                      </td>
                      <td>
                        <Badge tone={l.type === "make" ? "info" : "neutral"}>{l.type}</Badge>
                      </td>
                      <td className="num">{fmtQty(l.line.qty)}</td>
                      <td className="num">{Number(l.line.scrapPct).toFixed(1)}</td>
                      <td className="num">{fmtMoney(l.standardCost)}</td>
                      <td className="num">{fmtMoney(Number(l.standardCost) * Number(l.line.qty) * (1 + Number(l.line.scrapPct) / 100))}</td>
                      <td className="text-right">
                        <form action={removeBomLineAction}>
                          <input type="hidden" name="id" value={l.line.id} />
                          <input type="hidden" name="itemId" value={item.id} />
                          <button className="text-xs text-ink-3 hover:text-bad" type="submit">
                            remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                  {!lines.length ? (
                    <tr>
                      <td colSpan={8} className="text-ink-3">
                        No components yet. Add the first one below.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              <div className="border-t border-line p-3">
                <ActionForm action={addBomLineAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="itemId" value={item.id} />
                  <div className="w-44">
                    <span className="mb-1 block text-xs text-ink-2">Component SKU</span>
                    <Input name="componentSku" required placeholder="PLATE-001" />
                  </div>
                  <div className="w-24">
                    <span className="mb-1 block text-xs text-ink-2">Qty per</span>
                    <Input name="qty" type="number" step="0.0001" defaultValue={1} required />
                  </div>
                  <div className="w-24">
                    <span className="mb-1 block text-xs text-ink-2">Scrap %</span>
                    <Input name="scrapPct" type="number" step="0.1" defaultValue={0} />
                  </div>
                  <div className="w-32">
                    <span className="mb-1 block text-xs text-ink-2">Ref / position</span>
                    <Input name="refDes" placeholder="R1, left bracket…" />
                  </div>
                  <div className="flex-1">
                    <span className="mb-1 block text-xs text-ink-2">Note</span>
                    <Input name="notes" />
                  </div>
                  <SubmitButton size="md" variant="secondary">
                    Add component
                  </SubmitButton>
                </ActionForm>
              </div>
            </Card>
          ) : null}

          {item.type === "make" ? (
            <Card title={`Routing ${routing ? `· rev ${routing.rev}` : ""}`} padded={false}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Seq</th>
                    <th>Operation</th>
                    <th>Work center</th>
                    <th className="num">Setup h</th>
                    <th className="num">Run min/unit</th>
                    <th className="num">Outside $/unit</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ops.map((o) => (
                    <tr key={o.op.id}>
                      <td className="text-ink-3">{o.op.seq}</td>
                      <td>
                        <div className="font-medium">{o.op.name}</div>
                        {o.op.instructions ? <div className="text-xs text-ink-3">{o.op.instructions}</div> : null}
                      </td>
                      <td>{o.vendorName ? `Outside: ${o.vendorName}` : o.wc ?? "—"}</td>
                      <td className="num">{fmtQty(o.op.setupHours)}</td>
                      <td className="num">{fmtQty(Number(o.op.runHoursPerUnit) * 60)}</td>
                      <td className="num">{fmtMoney(o.op.outsideCostPerUnit)}</td>
                      <td className="text-right">
                        <form action={removeOperationAction}>
                          <input type="hidden" name="id" value={o.op.id} />
                          <input type="hidden" name="itemId" value={item.id} />
                          <button className="text-xs text-ink-3 hover:text-bad" type="submit">
                            remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                  {!ops.length ? (
                    <tr>
                      <td colSpan={7} className="text-ink-3">
                        No operations yet. Add the steps to make this item.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              <div className="border-t border-line p-3">
                <ActionForm action={addOperationAction} className="grid grid-cols-2 gap-2 md:grid-cols-6">
                  <input type="hidden" name="itemId" value={item.id} />
                  <div className="md:col-span-2">
                    <span className="mb-1 block text-xs text-ink-2">Operation</span>
                    <Input name="name" required placeholder="Cut, deburr, assemble…" />
                  </div>
                  <div>
                    <span className="mb-1 block text-xs text-ink-2">Work center</span>
                    <Select name="workCenterId" defaultValue="">
                      <option value="">—</option>
                      {wcs.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <span className="mb-1 block text-xs text-ink-2">Setup hours</span>
                    <Input name="setupHours" type="number" step="0.01" defaultValue={0} />
                  </div>
                  <div>
                    <span className="mb-1 block text-xs text-ink-2">Run min / unit</span>
                    <Input name="runMinutesPerUnit" type="number" step="0.1" defaultValue={0} />
                  </div>
                  <div>
                    <span className="mb-1 block text-xs text-ink-2">Outside vendor</span>
                    <Select name="outsideVendorId" defaultValue="">
                      <option value="">—</option>
                      {vendorList.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <span className="mb-1 block text-xs text-ink-2">Outside $ / unit</span>
                    <Input name="outsideCostPerUnit" type="number" step="0.01" defaultValue={0} />
                  </div>
                  <div className="md:col-span-4">
                    <span className="mb-1 block text-xs text-ink-2">Instructions (printed on the traveler)</span>
                    <Textarea name="instructions" className="min-h-9" rows={1} />
                  </div>
                  <div className="self-end">
                    <SubmitButton size="md" variant="secondary">
                      Add operation
                    </SubmitButton>
                  </div>
                </ActionForm>
              </div>
            </Card>
          ) : null}

          <Card title="Where used" padded={false}>
            <table className="data">
              <tbody>
                {used.map((u) => (
                  <tr key={`${u.parentId}-${u.rev}`}>
                    <td>
                      <Link href={`/items/${u.parentId}`} className="font-medium text-brand hover:underline">
                        {u.parentSku}
                      </Link>{" "}
                      <span className="text-ink-3">{u.parentName}</span>
                    </td>
                    <td>rev {u.rev}</td>
                    <td className="num">{fmtQty(u.qty)} per</td>
                  </tr>
                ))}
                {!used.length ? (
                  <tr>
                    <td className="text-ink-3">Not used in any BOM.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
        </div>

        <div className="space-y-4">
          <Card
            title="Cost"
            actions={
              <form action={recostItemAction}>
                <input type="hidden" name="itemId" value={item.id} />
                <button className="text-xs text-brand hover:underline" type="submit">
                  Recalculate
                </button>
              </form>
            }
          >
            <DL
              rows={[
                ["Material", fmtMoney(cost.material)],
                ["Labour", fmtMoney(cost.labor)],
                ["Outside", fmtMoney(cost.outside)],
                [`Overhead (${overheadPct}% of labour)`, fmtMoney(cost.overhead)],
                ["Rolled-up cost", <strong key="t">{fmtMoney(cost.total)}</strong>],
                ["Stored standard", fmtMoney(item.standardCost)],
                ["Average cost (stock)", fmtMoney(item.avgCost)],
                ["Last purchase cost", fmtMoney(item.lastCost)],
                ["Sales price", fmtMoney(item.salesPrice)],
                ["Margin at price", item.salesPrice ? `${(((Number(item.salesPrice) - cost.total) / Number(item.salesPrice)) * 100).toFixed(1)}%` : "—"],
              ]}
            />
          </Card>
          <Card title={`Stock · ${fmtQty(total)} ${item.uom}`}>
            {stock.length ? (
              <table className="data">
                <tbody>
                  {stock.map((s) => (
                    <tr key={`${s.locationId}-${s.lotNumber}`}>
                      <td>{s.code}</td>
                      <td className="text-ink-3">{s.lotNumber ?? ""}</td>
                      <td className="num">{fmtQty(s.onHand)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-ink-3">Nothing on hand.</p>
            )}
            <div className="mt-3 flex gap-2">
              <LinkButton href={`/inventory/adjust?itemId=${item.id}`} variant="secondary" size="sm">
                Adjust / count
              </LinkButton>
              <LinkButton href={`/inventory?itemId=${item.id}`} variant="ghost" size="sm">
                History
              </LinkButton>
            </div>
          </Card>
          <Card title="Planning">
            <DL
              rows={[
                ["Reorder point", fmtQty(item.reorderPoint)],
                ["Reorder qty", fmtQty(item.reorderQty)],
                ["Safety stock", fmtQty(item.safetyStock)],
                ["Min order qty", fmtQty(item.minOrderQty)],
                ["Lead time", `${item.leadTimeDays} days`],
                ["Lots", item.trackLots ? "tracked" : "not tracked"],
                ["Shelf life", item.shelfLifeDays ? `${item.shelfLifeDays} days` : "—"],
                ["Weight", Number(item.weight) ? `${fmtQty(item.weight)} lb` : "—"],
                ["Category", item.category],
                ["Barcode", item.barcode],
                ["BOM revisions", revs.map((r) => `${r.rev} (${r.status})`).join(", ") || "—"],
              ]}
            />
          </Card>
          {item.type === "buy" ? (
            <Card title="Vendors" padded={false}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Their p/n</th>
                    <th className="num">Last cost</th>
                    <th className="num">Lead d</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => (
                    <tr key={s.vi.id}>
                      <td>
                        <Link href={`/vendors/${s.vendorId}`} className="text-brand hover:underline">
                          {s.vendorName}
                        </Link>
                        {s.vi.preferred ? <span className="ml-1 text-xs text-ink-3">preferred</span> : null}
                      </td>
                      <td>{s.vi.vendorPartNo}</td>
                      <td className="num">{fmtMoney(s.vi.lastCost)}</td>
                      <td className="num">{s.vi.leadTimeDays ?? s.vendorLead}</td>
                    </tr>
                  ))}
                  {!suppliers.length ? (
                    <tr>
                      <td colSpan={4} className="text-ink-3">
                        No vendor prices yet. Add them on the vendor&apos;s page or receive a PO.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              <div className="p-3">
                <LinkButton href={`/purchasing/new?itemId=${item.id}${item.preferredVendorId ? `&vendorId=${item.preferredVendorId}` : ""}`} variant="secondary" size="sm">
                  Raise PO
                </LinkButton>
              </div>
            </Card>
          ) : null}
          <AttachmentsCard entityType="item" entityId={item.id} rows={docs} />
        </div>
      </div>
    </>
  );
}
