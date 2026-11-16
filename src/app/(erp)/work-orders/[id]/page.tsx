import Link from "next/link";
import { uuidOr404 } from "@/lib/ids";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { attachments, employees, items, laborEntries, purchaseOrders, salesOrderLines, salesOrders, workCenters, workOrderMaterials, workOrderOperations, workOrders } from "@/lib/db/schema";
import { pickEmployees, pickLocations } from "@/lib/pick";
import { onHand } from "@/modules/inventory/service";
import { Card, DL, PageHeader, StatusBadge } from "@/components/ui/page";
import { Button, LinkButton } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/fields";
import { cancelWorkOrderAction, completeWorkOrderAction, issueAllAction, issueMaterialAction, recordLaborAction, releaseWorkOrderAction } from "@/modules/production/actions";
import { AttachmentsCard } from "@/components/forms/attachments";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty } from "@/lib/money";

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [row] = await db.select({ wo: workOrders, item: items }).from(workOrders).innerJoin(items, eq(items.id, workOrders.itemId)).where(and(eq(workOrders.id, id), eq(workOrders.orgId, ctx.orgId)));
  if (!row) notFound();
  const { wo, item } = row;
  const [ops, mats, labor, emps, locs, pos, docs, soLine] = await Promise.all([
    db.select({ op: workOrderOperations, wc: workCenters.name }).from(workOrderOperations).leftJoin(workCenters, eq(workCenters.id, workOrderOperations.workCenterId)).where(eq(workOrderOperations.workOrderId, wo.id)).orderBy(asc(workOrderOperations.seq)),
    db.select({ m: workOrderMaterials, sku: items.sku, name: items.name, avgCost: items.avgCost }).from(workOrderMaterials).innerJoin(items, eq(items.id, workOrderMaterials.itemId)).where(eq(workOrderMaterials.workOrderId, wo.id)),
    db.select({ l: laborEntries, emp: employees.name, opName: workOrderOperations.name }).from(laborEntries).innerJoin(employees, eq(employees.id, laborEntries.employeeId)).innerJoin(workOrderOperations, eq(workOrderOperations.id, laborEntries.workOrderOperationId)).where(eq(workOrderOperations.workOrderId, wo.id)).orderBy(desc(laborEntries.startedAt)),
    pickEmployees(db, ctx.orgId),
    pickLocations(db, ctx.orgId),
    db.select().from(purchaseOrders).where(eq(purchaseOrders.workOrderId, wo.id)),
    db.select().from(attachments).where(and(eq(attachments.orgId, ctx.orgId), eq(attachments.entityType, "work-order"), eq(attachments.entityId, wo.id))),
    wo.salesOrderLineId ? db.select({ l: salesOrderLines, o: salesOrders }).from(salesOrderLines).innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId)).where(eq(salesOrderLines.id, wo.salesOrderLineId)).then((r) => r[0]) : Promise.resolve(undefined),
  ]);
  const stock = await Promise.all(mats.map((m) => onHand(db, ctx.orgId, m.m.itemId)));
  const onFloor = ["released", "in_progress"].includes(wo.status);
  const stockLocs = locs.filter((l) => l.type !== "wip");
  const cost = Number(wo.materialCost) + Number(wo.laborCost) + Number(wo.outsideCost) + Number(wo.overheadCost);
  const plannedHours = ops.reduce((s, o) => s + Number(o.op.plannedSetupHours) + Number(o.op.plannedRunHours), 0);
  const actualHours = ops.reduce((s, o) => s + Number(o.op.actualHours), 0);
  const remaining = Number(wo.qty) - Number(wo.qtyComplete) - Number(wo.qtyScrap);

  return (
    <>
      <PageHeader
        title={wo.number}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={wo.status} />
            <span>
              <Link href={`/items/${item.id}`} className="text-brand hover:underline">
                {item.sku}
              </Link>{" "}
              {item.name} · {fmtQty(wo.qty)} {item.uom} · due {fmtDate(wo.dueDate) || "—"} · priority {wo.priority}
            </span>
          </span>
        }
        crumbs={[{ href: "/work-orders", label: "Work orders" }]}
        actions={
          <>
            <LinkButton href={`/print/traveler/${wo.id}`} variant="secondary">
              Traveler
            </LinkButton>
            {wo.status === "planned" ? (
              <>
                <form action={releaseWorkOrderAction}>
                  <input type="hidden" name="id" value={wo.id} />
                  <Button type="submit">Release to floor</Button>
                </form>
                <form action={cancelWorkOrderAction}>
                  <input type="hidden" name="id" value={wo.id} />
                  <Button type="submit" variant="danger">
                    Cancel
                  </Button>
                </form>
              </>
            ) : null}
            {onFloor ? (
              <LinkButton href={`/purchasing/new?workOrderId=${wo.id}`} variant="secondary">
                Outside processing PO
              </LinkButton>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Operations" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>Seq</th>
                  <th>Operation</th>
                  <th>Work center</th>
                  <th className="num">Planned h</th>
                  <th className="num">Actual h</th>
                  <th className="num">Good</th>
                  <th className="num">Scrap</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {ops.map(({ op, wc }) => (
                  <tr key={op.id}>
                    <td className="text-ink-3">{op.seq}</td>
                    <td>
                      <div className="font-medium">{op.name}</div>
                      {op.instructions ? <div className="text-xs text-ink-3">{op.instructions}</div> : null}
                    </td>
                    <td>{op.outsideVendorId ? "Outside" : wc ?? "—"}</td>
                    <td className="num">{fmtQty(Number(op.plannedSetupHours) + Number(op.plannedRunHours))}</td>
                    <td className="num">{fmtQty(op.actualHours)}</td>
                    <td className="num">{fmtQty(op.qtyComplete)}</td>
                    <td className="num">{fmtQty(op.qtyScrap)}</td>
                    <td>
                      <StatusBadge status={op.status} />
                    </td>
                  </tr>
                ))}
                {!ops.length ? (
                  <tr>
                    <td colSpan={8} className="text-ink-3">
                      No routing on this item. Add operations on the item to get a traveler and labour tracking.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
          <Card title="Materials" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>Component</th>
                  <th className="num">Required</th>
                  <th className="num">Issued</th>
                  <th className="num">In stock</th>
                  <th className="num">Avg cost</th>
                </tr>
              </thead>
              <tbody>
                {mats.map(({ m, sku, name, avgCost }, i) => {
                  const short = Number(m.qtyRequired) - Number(m.qtyIssued) > stock[i];
                  return (
                    <tr key={m.id}>
                      <td>
                        <Link href={`/items/${m.itemId}`} className="text-brand hover:underline">
                          {sku}
                        </Link>{" "}
                        <span className="text-ink-3">{name}</span>
                      </td>
                      <td className="num">{fmtQty(m.qtyRequired)}</td>
                      <td className={`num ${Number(m.qtyIssued) >= Number(m.qtyRequired) ? "text-good" : ""}`}>{fmtQty(m.qtyIssued)}</td>
                      <td className={`num ${short && Number(m.qtyIssued) < Number(m.qtyRequired) ? "text-warn" : ""}`}>{fmtQty(stock[i])}</td>
                      <td className="num">{fmtMoney(avgCost)}</td>
                    </tr>
                  );
                })}
                {!mats.length ? (
                  <tr>
                    <td colSpan={5} className="text-ink-3">
                      No BOM on this item.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            {onFloor && mats.length ? (
              <div className="grid gap-3 border-t border-line p-3 md:grid-cols-2">
                <ActionForm action={issueAllAction} className="flex items-end gap-2">
                  <input type="hidden" name="workOrderId" value={wo.id} />
                  <div className="flex-1">
                    <span className="mb-1 block text-xs text-ink-2">Issue everything still required from</span>
                    <Select name="locationId" defaultValue={stockLocs[0]?.id ?? ""}>
                      {stockLocs.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code} · {l.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <SubmitButton>Issue all</SubmitButton>
                </ActionForm>
                <ActionForm action={issueMaterialAction} className="flex items-end gap-2">
                  <input type="hidden" name="workOrderId" value={wo.id} />
                  <div className="flex-1">
                    <span className="mb-1 block text-xs text-ink-2">Issue one component</span>
                    <Select name="itemId" defaultValue={mats[0]?.m.itemId ?? ""}>
                      {mats.map(({ m, sku }) => (
                        <option key={m.id} value={m.itemId}>
                          {sku}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="w-24">
                    <span className="mb-1 block text-xs text-ink-2">Qty</span>
                    <Input name="qty" type="number" step="0.0001" required />
                  </div>
                  <div className="w-32">
                    <span className="mb-1 block text-xs text-ink-2">From</span>
                    <Select name="locationId" defaultValue={stockLocs[0]?.id ?? ""}>
                      {stockLocs.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <SubmitButton variant="secondary">Issue</SubmitButton>
                </ActionForm>
              </div>
            ) : null}
          </Card>
          {onFloor && ops.length ? (
            <Card title="Record labour (manual entry)">
              <ActionForm action={recordLaborAction} className="grid grid-cols-2 gap-2 md:grid-cols-6">
                <input type="hidden" name="workOrderId" value={wo.id} />
                <div className="md:col-span-2">
                  <span className="mb-1 block text-xs text-ink-2">Operation</span>
                  <Select name="operationId" defaultValue={ops.find((o) => o.op.status !== "complete")?.op.id ?? ops[0].op.id}>
                    {ops.map(({ op }) => (
                      <option key={op.id} value={op.id}>
                        {op.seq} · {op.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <span className="mb-1 block text-xs text-ink-2">Employee</span>
                  <Select name="employeeId" defaultValue={emps[0]?.id ?? ""}>
                    {emps.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <span className="mb-1 block text-xs text-ink-2">Hours</span>
                  <Input name="hours" type="number" step="0.01" required />
                </div>
                <div>
                  <span className="mb-1 block text-xs text-ink-2">Good qty</span>
                  <Input name="qtyGood" type="number" step="0.0001" />
                </div>
                <div>
                  <span className="mb-1 block text-xs text-ink-2">Scrap qty</span>
                  <Input name="qtyScrap" type="number" step="0.0001" />
                </div>
                <label className="flex items-center gap-2 text-sm md:col-span-4">
                  <input type="checkbox" name="operationComplete" /> Operation finished
                </label>
                <div className="md:col-span-2">
                  <SubmitButton variant="secondary" className="w-full">
                    Record
                  </SubmitButton>
                </div>
              </ActionForm>
              {!emps.length ? (
                <p className="mt-2 text-xs text-warn">
                  No employees yet.{" "}
                  <Link href="/people" className="underline">
                    Add people
                  </Link>{" "}
                  with an hourly rate first.
                </p>
              ) : null}
            </Card>
          ) : null}
          {labor.length ? (
            <Card title="Labour log" padded={false}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Who</th>
                    <th>Operation</th>
                    <th>Start</th>
                    <th>End</th>
                    <th className="num">Hours</th>
                    <th className="num">Good</th>
                    <th className="num">Scrap</th>
                    <th className="num">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {labor.map(({ l, emp, opName }) => (
                    <tr key={l.id}>
                      <td>{emp}</td>
                      <td>{opName}</td>
                      <td>{fmtDateTime(l.startedAt)}</td>
                      <td>{l.endedAt ? fmtDateTime(l.endedAt) : <span className="text-warn">clocked in</span>}</td>
                      <td className="num">{fmtQty(l.hours)}</td>
                      <td className="num">{fmtQty(l.qtyGood)}</td>
                      <td className="num">{fmtQty(l.qtyScrap)}</td>
                      <td className="num">{fmtMoney(Number(l.hours) * Number(l.hourlyRate))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}
        </div>
        <div className="space-y-4">
          <Card title="Job cost">
            <DL
              rows={[
                ["Material", fmtMoney(wo.materialCost)],
                ["Labour", fmtMoney(wo.laborCost)],
                ["Outside", fmtMoney(wo.outsideCost)],
                ["Overhead", fmtMoney(wo.overheadCost)],
                ["Total so far", <strong key="t">{fmtMoney(cost)}</strong>],
                ["Per unit (planned qty)", fmtMoney(Number(wo.qty) ? cost / Number(wo.qty) : 0)],
                ["Standard cost", fmtMoney(item.standardCost)],
                ["Hours planned / actual", `${fmtQty(plannedHours)} / ${fmtQty(actualHours)}`],
                ["Sales order", soLine ? <Link key="so" href={`/orders/${soLine.o.id}`} className="text-brand hover:underline">{soLine.o.number} · {fmtMoney(soLine.l.unitPrice)}/unit</Link> : "stock"],
                ["Outside POs", pos.length ? pos.map((p) => <Link key={p.id} href={`/purchasing/${p.id}`} className="mr-2 text-brand hover:underline">{p.number}</Link>) : "—"],
                ["Notes", wo.notes],
              ]}
            />
          </Card>
          {onFloor ? (
            <Card title="Complete">
              <ActionForm action={completeWorkOrderAction} className="space-y-2">
                <input type="hidden" name="workOrderId" value={wo.id} />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="mb-1 block text-xs text-ink-2">Good</span>
                    <Input name="qtyGood" type="number" step="0.0001" defaultValue={Math.max(0, remaining)} required />
                  </div>
                  <div>
                    <span className="mb-1 block text-xs text-ink-2">Scrap</span>
                    <Input name="qtyScrap" type="number" step="0.0001" defaultValue={0} />
                  </div>
                </div>
                <Select name="locationId" defaultValue={stockLocs[0]?.id ?? ""}>
                  {stockLocs.map((l) => (
                    <option key={l.id} value={l.id}>
                      Into {l.code} · {l.name}
                    </option>
                  ))}
                </Select>
                <Input name="lotNumber" placeholder={`Lot (default ${wo.number})`} />
                <SubmitButton className="w-full">Complete work order</SubmitButton>
                <p className="text-xs text-ink-3">Applies overhead, writes off scrap, relieves WIP and puts the good units in stock at their actual cost.</p>
              </ActionForm>
            </Card>
          ) : null}
          {wo.status === "complete" ? (
            <Card title="Result">
              <DL
                rows={[
                  ["Completed", fmtDateTime(wo.completedAt)],
                  ["Good / scrap", `${fmtQty(wo.qtyComplete)} / ${fmtQty(wo.qtyScrap)}`],
                  ["Actual unit cost", fmtMoney(Number(wo.qtyComplete) ? (cost - (cost / (Number(wo.qtyComplete) + Number(wo.qtyScrap))) * Number(wo.qtyScrap)) / Number(wo.qtyComplete) : 0)],
                  ["vs standard", fmtMoney(item.standardCost)],
                ]}
              />
            </Card>
          ) : null}
          <AttachmentsCard entityType="work-order" entityId={wo.id} rows={docs} returnTo={`/work-orders/${wo.id}`} />
        </div>
      </div>
    </>
  );
}
