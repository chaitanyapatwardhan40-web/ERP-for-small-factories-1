import Link from "next/link";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { employees, items, laborEntries, workCenters, workOrderOperations, workOrders } from "@/lib/db/schema";
import { Card, PageHeader, StatusBadge } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/fields";
import { clockInAction, clockOutAction } from "@/modules/production/actions";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/money";

export const metadata = { title: "Shop floor" };

/**
 * The tablet screen: big buttons, one job at a time. Clock in on an
 * operation, clock out with quantities; labour cost lands on the job.
 */
export default async function ShopFloorPage({ searchParams }: { searchParams: Promise<{ wc?: string }> }) {
  const { wc } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const [emps, centers, open, ops] = await Promise.all([
    db.select().from(employees).where(and(eq(employees.orgId, ctx.orgId), eq(employees.active, true))).orderBy(asc(employees.name)),
    db.select().from(workCenters).where(and(eq(workCenters.orgId, ctx.orgId), eq(workCenters.active, true))).orderBy(asc(workCenters.code)),
    db
      .select({ l: laborEntries, emp: employees.name, opName: workOrderOperations.name, woNumber: workOrders.number, woId: workOrders.id })
      .from(laborEntries)
      .innerJoin(employees, eq(employees.id, laborEntries.employeeId))
      .innerJoin(workOrderOperations, eq(workOrderOperations.id, laborEntries.workOrderOperationId))
      .innerJoin(workOrders, eq(workOrders.id, workOrderOperations.workOrderId))
      .where(and(eq(laborEntries.orgId, ctx.orgId), isNull(laborEntries.endedAt))),
    db
      .select({ op: workOrderOperations, woNumber: workOrders.number, woId: workOrders.id, dueDate: workOrders.dueDate, priority: workOrders.priority, sku: items.sku, itemName: items.name, qty: workOrders.qty, notes: workOrders.notes })
      .from(workOrderOperations)
      .innerJoin(workOrders, eq(workOrders.id, workOrderOperations.workOrderId))
      .innerJoin(items, eq(items.id, workOrders.itemId))
      .where(and(eq(workOrderOperations.orgId, ctx.orgId), inArray(workOrders.status, ["released", "in_progress"]), inArray(workOrderOperations.status, ["pending", "in_progress"])))
      .orderBy(asc(workOrders.priority), asc(workOrders.dueDate), asc(workOrderOperations.seq)),
  ]);
  const shown = wc ? ops.filter((o) => o.op.workCenterId === wc) : ops;
  return (
    <>
      <PageHeader title="Shop floor" description="Pick your name, find the job, clock in. Clock out with what you made." />
      <div className="mb-4 flex flex-wrap gap-1">
        <Link href="/shop-floor" className={`rounded-full border px-3 py-1.5 text-sm ${!wc ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-white"}`}>
          All work centers
        </Link>
        {centers.map((c) => (
          <Link key={c.id} href={`/shop-floor?wc=${c.id}`} className={`rounded-full border px-3 py-1.5 text-sm ${wc === c.id ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-white"}`}>
            {c.name}
          </Link>
        ))}
      </div>
      {open.length ? (
        <Card title="Clocked in now" className="mb-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {open.map(({ l, emp, opName, woNumber, woId }) => (
              <div key={l.id} className="rounded-md border border-warn/30 bg-warn-soft p-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{emp}</div>
                  <div className="text-xs text-ink-3">since {fmtDateTime(l.startedAt)}</div>
                </div>
                <div className="text-sm">
                  <Link href={`/work-orders/${woId}`} className="font-medium text-brand hover:underline">
                    {woNumber}
                  </Link>{" "}
                  · {opName}
                </div>
                <ActionForm action={clockOutAction} className="mt-2 grid grid-cols-3 gap-2">
                  <input type="hidden" name="laborEntryId" value={l.id} />
                  <Input name="qtyGood" type="number" step="0.0001" placeholder="Good" />
                  <Input name="qtyScrap" type="number" step="0.0001" placeholder="Scrap" />
                  <SubmitButton size="md" className="w-full">
                    Clock out
                  </SubmitButton>
                  <label className="col-span-3 flex items-center gap-2 text-xs">
                    <input type="checkbox" name="operationComplete" /> This operation is finished
                  </label>
                </ActionForm>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((o) => (
          <Card key={o.op.id} className={o.op.status === "in_progress" ? "border-brand/40" : ""}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-lg font-semibold">
                  <Link href={`/work-orders/${o.woId}`} className="text-brand hover:underline">
                    {o.woNumber}
                  </Link>
                </div>
                <div className="text-sm">
                  {o.sku} · {o.itemName} · {fmtQty(o.qty)}
                </div>
                <div className="mt-1 text-sm font-medium">
                  Op {o.op.seq}: {o.op.name}
                </div>
                {o.op.instructions ? <div className="text-xs text-ink-2">{o.op.instructions}</div> : null}
                {o.notes ? <div className="mt-1 text-xs text-ink-3">Note: {o.notes}</div> : null}
              </div>
              <div className="text-right text-xs text-ink-3">
                <StatusBadge status={o.op.status} />
                <div className="mt-1">due {fmtDate(o.dueDate) || "—"}</div>
                <div>pri {o.priority}</div>
                <div>
                  {fmtQty(o.op.qtyComplete)}/{fmtQty(o.qty)} done
                </div>
              </div>
            </div>
            <ActionForm action={clockInAction} className="mt-3 flex gap-2">
              <input type="hidden" name="operationId" value={o.op.id} />
              <Select name="employeeId" required defaultValue="">
                <option value="">Who are you?</option>
                {emps.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
              <SubmitButton size="md">Clock in</SubmitButton>
            </ActionForm>
            <div className="mt-2 text-right">
              <Link href={`/print/traveler/${o.woId}`} className="text-xs text-ink-3 hover:text-ink">
                traveler
              </Link>
            </div>
          </Card>
        ))}
        {!shown.length ? <p className="text-sm text-ink-3">No open operations{wc ? " at this work center" : ""}. Release a work order to see jobs here.</p> : null}
      </div>
    </>
  );
}
