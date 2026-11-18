import Link from "next/link";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { scheduleBoard } from "@/modules/production/service";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui/page";
import { fmtDate, fmtQty, today } from "@/lib/money";

export const metadata = { title: "Schedule" };

export default async function SchedulePage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const board = await scheduleBoard(db, ctx.orgId);
  const t = today();
  const total = board.reduce((s, b) => s + b.operations.length, 0);
  return (
    <>
      <PageHeader title="Schedule" />
      {total ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {board.map(({ workCenter, operations, loadHours, daysOfWork }) => (
            <Card
              key={workCenter.id}
              title={
                <span className="flex items-center gap-2">
                  {workCenter.name}
                  <span className={`text-xs font-normal ${daysOfWork > 5 ? "text-bad" : daysOfWork > 2 ? "text-warn" : "text-ink-3"}`}>
                    {fmtQty(loadHours)} h · {daysOfWork.toFixed(1)} days
                  </span>
                </span>
              }
              padded={false}
            >
              {operations.length ? (
                <ul className="divide-y divide-line">
                  {operations.map((o) => (
                    <li key={o.op.id} className="px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/work-orders/${o.woId}`} className="font-medium text-brand hover:underline">
                          {o.woNumber}
                        </Link>
                        <StatusBadge status={o.op.status} />
                      </div>
                      <div className="text-ink-2">
                        {o.op.seq} · {o.op.name} · {o.sku} × {fmtQty(o.woQty)}
                      </div>
                      <div className="flex justify-between text-xs text-ink-3">
                        <span className={o.dueDate && o.dueDate < t ? "font-medium text-bad" : ""}>due {fmtDate(o.dueDate) || "—"}</span>
                        <span>
                          pri {o.priority} · {fmtQty(Math.max(0, Number(o.op.plannedSetupHours) + Number(o.op.plannedRunHours) - Number(o.op.actualHours)))} h left
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-4 text-sm text-ink-3">Nothing queued.</p>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="Nothing on the schedule" hint="Release a work order with a routing and its operations show up here by work center." />
      )}
    </>
  );
}
