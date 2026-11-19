import { asc, desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { gaugeCalibrations, gauges } from "@/lib/db/schema";
import { Card, PageHeader, Tabs, StatusBadge } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select } from "@/components/ui/fields";
import { calibrateGaugeAction, saveGaugeAction } from "@/modules/quality/actions";
import { addDays, fmtDate, today } from "@/lib/money";
import { QUALITY_TABS } from "../tabs";

export const metadata = { title: "Gauges" };

export default async function GaugesPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const rows = await db.select().from(gauges).where(eq(gauges.orgId, ctx.orgId)).orderBy(asc(gauges.nextDueAt));
  const history = await db.select().from(gaugeCalibrations).where(eq(gaugeCalibrations.orgId, ctx.orgId)).orderBy(desc(gaugeCalibrations.calibratedAt)).limit(60);
  const t = today();
  const soon = rows.filter((g) => g.nextDueAt && g.nextDueAt > t && g.nextDueAt <= addDays(t, 30)).length;
  const overdue = rows.filter((g) => g.nextDueAt && g.nextDueAt <= t).length;
  return (
    <>
      <PageHeader title="Gauges and calibration" description={`${overdue} overdue · ${soon} due within 30 days`} />
      <Tabs tabs={QUALITY_TABS} current="/quality/gauges" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card padded={false} className="lg:col-span-2">
          <table className="data">
            <thead>
              <tr>
                <th>Gauge</th>
                <th>Serial</th>
                <th>Location</th>
                <th className="num">Interval</th>
                <th>Last</th>
                <th>Due</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => {
                const due = g.nextDueAt && g.nextDueAt <= t;
                return (
                  <tr key={g.id}>
                    <td className="font-medium">
                      {g.name}
                      {g.owner ? <div className="text-xs text-ink-3">{g.owner}</div> : null}
                    </td>
                    <td className="font-mono text-xs">{g.serial}</td>
                    <td>{g.location}</td>
                    <td className="num">{g.calibrationIntervalDays} d</td>
                    <td>{fmtDate(g.lastCalibratedAt)}</td>
                    <td className={due ? "font-medium text-bad" : ""}>{fmtDate(g.nextDueAt) || "—"}</td>
                    <td>
                      <StatusBadge status={due ? "due" : g.status} />
                    </td>
                    <td>
                      <form action={calibrateGaugeAction} className="flex flex-wrap gap-1">
                        <input type="hidden" name="id" value={g.id} />
                        <Input name="date" type="date" defaultValue={t} className="w-36" />
                        <Select name="result" defaultValue="pass" className="w-28">
                          <option value="pass">Pass</option>
                          <option value="adjusted">Adjusted</option>
                          <option value="fail">Fail</option>
                        </Select>
                        <Input name="certNo" placeholder="Cert #" className="w-28" />
                        <Button type="submit" size="sm" variant="secondary">
                          Record
                        </Button>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {!rows.length ? (
                <tr>
                  <td colSpan={8} className="text-ink-3">
                    No gauges yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
        <Card title="Add gauge">
          <ActionForm action={saveGaugeAction} className="space-y-3">
            <FormGrid cols={2}>
              <Field label="Name" className="md:col-span-2">
                <Input name="name" required placeholder="Mitutoyo 0-1in micrometer" />
              </Field>
              <Field label="Serial">
                <Input name="serial" />
              </Field>
              <Field label="Location">
                <Input name="location" placeholder="Inspection bench, CNC1…" />
              </Field>
              <Field label="Owner">
                <Input name="owner" />
              </Field>
              <Field label="Interval (days)">
                <Input name="calibrationIntervalDays" type="number" defaultValue={365} />
              </Field>
              <Field label="Last calibrated">
                <Input name="lastCalibratedAt" type="date" />
              </Field>
            </FormGrid>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Calibration history" padded={false} className="lg:col-span-3">
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Gauge</th>
                <th>Result</th>
                <th>Cert #</th>
                <th>By</th>
                <th>Next due</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{fmtDate(h.calibratedAt)}</td>
                  <td>{rows.find((g) => g.id === h.gaugeId)?.name ?? "—"}</td>
                  <td>
                    <StatusBadge status={h.result} />
                  </td>
                  <td className="font-mono text-xs">{h.certNo}</td>
                  <td>{h.performedBy}</td>
                  <td>{fmtDate(h.dueAt)}</td>
                  <td className="text-ink-3">{h.notes}</td>
                </tr>
              ))}
              {!history.length ? (
                <tr>
                  <td colSpan={7} className="text-ink-3">
                    No calibrations recorded yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
