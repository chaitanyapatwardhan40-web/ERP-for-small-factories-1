import { asc, desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { assets, downtimeLogs, maintenanceTasks, workCenters } from "@/lib/db/schema";
import { Card, PageHeader, StatusBadge } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/fields";
import { backUpAction, completeTaskAction, downtimeAction, saveAssetAction, saveTaskAction } from "@/modules/maintenance/actions";
import { addDays, fmtDate, fmtDateTime, today } from "@/lib/money";

export const metadata = { title: "Maintenance" };

export default async function MaintenancePage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const [machines, tasks, downtime, wcs] = await Promise.all([
    db.select({ a: assets, wc: workCenters.name }).from(assets).leftJoin(workCenters, eq(workCenters.id, assets.workCenterId)).where(eq(assets.orgId, ctx.orgId)).orderBy(asc(assets.name)),
    db.select({ t: maintenanceTasks, asset: assets.name }).from(maintenanceTasks).innerJoin(assets, eq(assets.id, maintenanceTasks.assetId)).where(eq(maintenanceTasks.orgId, ctx.orgId)).orderBy(asc(maintenanceTasks.nextDueAt)),
    db.select({ d: downtimeLogs, asset: assets.name }).from(downtimeLogs).innerJoin(assets, eq(assets.id, downtimeLogs.assetId)).where(eq(downtimeLogs.orgId, ctx.orgId)).orderBy(desc(downtimeLogs.startedAt)).limit(20),
    db.select().from(workCenters).where(eq(workCenters.orgId, ctx.orgId)),
  ]);
  const t = today();
  // Uptime over the last 30 days: scheduled hours (work center capacity × working days) less logged downtime.
  const since = new Date(`${addDays(t, -30)}T00:00:00`);
  const downtimeHours = (assetId: string) =>
    downtime
      .filter((d) => d.d.assetId === assetId && d.d.startedAt >= since)
      .reduce((s, d) => s + Math.max(0, ((d.d.endedAt ?? new Date()).getTime() - d.d.startedAt.getTime()) / 3_600_000), 0);
  const uptimePct = (a: typeof assets.$inferSelect) => {
    const wc = wcs.find((w) => w.id === a.workCenterId);
    const scheduled = Number(wc?.capacityHoursPerDay ?? 8) * 22;
    return scheduled > 0 ? Math.max(0, Math.min(100, ((scheduled - downtimeHours(a.id)) / scheduled) * 100)) : null;
  };
  return (
    <>
      <PageHeader title="Machines and maintenance" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Machines" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>Machine</th>
                  <th>Work center</th>
                  <th>Serial</th>
                  <th>Location</th>
                  <th className="num">Uptime 30 d</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {machines.map(({ a, wc }) => (
                  <tr key={a.id}>
                    <td className="font-medium">
                      {a.name}
                      {a.manufacturer || a.model ? <div className="text-xs text-ink-3">{[a.manufacturer, a.model].filter(Boolean).join(" ")}</div> : null}
                    </td>
                    <td>{wc}</td>
                    <td className="font-mono text-xs">{a.serial}</td>
                    <td>{a.location}</td>
                    <td className="num">{uptimePct(a) === null ? "—" : `${uptimePct(a)!.toFixed(0)}%`}</td>
                    <td>
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="text-right">
                      {a.status === "down" ? (
                        <form action={backUpAction}>
                          <input type="hidden" name="assetId" value={a.id} />
                          <Button type="submit" size="sm" variant="secondary">
                            Back up
                          </Button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!machines.length ? (
                  <tr>
                    <td colSpan={7} className="text-ink-3">
                      No machines yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
          <Card title="Preventive maintenance" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Machine</th>
                  <th className="num">Every</th>
                  <th>Last</th>
                  <th>Due</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(({ t: task, asset }) => {
                  const due = task.nextDueAt && task.nextDueAt <= t;
                  return (
                    <tr key={task.id}>
                      <td>
                        <div className="font-medium">{task.name}</div>
                        {task.instructions ? <div className="text-xs text-ink-3">{task.instructions}</div> : null}
                      </td>
                      <td>{asset}</td>
                      <td className="num">{task.intervalDays} d</td>
                      <td>{fmtDate(task.lastDoneAt)}</td>
                      <td className={due ? "font-medium text-bad" : ""}>{fmtDate(task.nextDueAt)}</td>
                      <td className="text-right">
                        <form action={completeTaskAction}>
                          <input type="hidden" name="id" value={task.id} />
                          <Button type="submit" size="sm" variant={due ? "primary" : "ghost"}>
                            Done today
                          </Button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
                {!tasks.length ? (
                  <tr>
                    <td colSpan={6} className="text-ink-3">
                      No preventive tasks yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
          <Card title="Downtime log" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>Machine</th>
                  <th>Down since</th>
                  <th>Back up</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {downtime.map(({ d, asset }) => (
                  <tr key={d.id}>
                    <td>{asset}</td>
                    <td>{fmtDateTime(d.startedAt)}</td>
                    <td>{d.endedAt ? fmtDateTime(d.endedAt) : <span className="text-bad">still down</span>}</td>
                    <td>
                      {d.reason}
                      {d.notes ? <span className="text-ink-3"> · {d.notes}</span> : null}
                    </td>
                  </tr>
                ))}
                {!downtime.length ? (
                  <tr>
                    <td colSpan={4} className="text-ink-3">
                      No downtime logged.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Add machine">
            <ActionForm action={saveAssetAction} className="space-y-2">
              <Input name="name" placeholder="Haas VF-2 #1" required />
              <Select name="workCenterId" defaultValue="">
                <option value="">Work center…</option>
                {wcs.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
              <Input name="serial" placeholder="Serial" />
              <div className="grid grid-cols-2 gap-2">
                <Input name="manufacturer" placeholder="Manufacturer" />
                <Input name="model" placeholder="Model" />
              </div>
              <Input name="location" placeholder="Location (bay, cell)" />
              <Input name="purchasedAt" type="date" />
              <SubmitButton className="w-full">Add</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Schedule a PM task">
            <ActionForm action={saveTaskAction} className="space-y-2">
              <Select name="assetId" required defaultValue="">
                <option value="">Machine…</option>
                {machines.map(({ a }) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <Input name="name" placeholder="Change way oil, check belts" required />
              <div className="grid grid-cols-2 gap-2">
                <Input name="intervalDays" type="number" defaultValue={90} />
                <Input name="lastDoneAt" type="date" defaultValue={t} />
              </div>
              <Textarea name="instructions" placeholder="Instructions" className="min-h-12" />
              <SubmitButton variant="secondary" className="w-full">
                Schedule
              </SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Report downtime">
            <ActionForm action={downtimeAction} className="space-y-2">
              <Select name="assetId" required defaultValue="">
                <option value="">Machine…</option>
                {machines.map(({ a }) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <Input name="reason" placeholder="Reason (spindle fault)" required />
              <Input name="notes" placeholder="Notes" />
              <SubmitButton variant="danger" className="w-full">
                Machine is down
              </SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
