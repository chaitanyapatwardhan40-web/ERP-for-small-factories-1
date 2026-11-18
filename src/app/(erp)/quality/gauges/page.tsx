import { asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { gauges } from "@/lib/db/schema";
import { Card, PageHeader, Tabs, StatusBadge } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input } from "@/components/ui/fields";
import { calibrateGaugeAction, saveGaugeAction } from "@/modules/quality/actions";
import { fmtDate, today } from "@/lib/money";
import { QUALITY_TABS } from "../tabs";

export const metadata = { title: "Gauges" };

export default async function GaugesPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const rows = await db.select().from(gauges).where(eq(gauges.orgId, ctx.orgId)).orderBy(asc(gauges.nextDueAt));
  const t = today();
  return (
    <>
      <PageHeader title="Gauges and calibration" />
      <Tabs tabs={QUALITY_TABS} current="/quality/gauges" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card padded={false} className="lg:col-span-2">
          <table className="data">
            <thead>
              <tr>
                <th>Gauge</th>
                <th>Serial</th>
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
                    <td className="font-medium">{g.name}</td>
                    <td className="font-mono text-xs">{g.serial}</td>
                    <td className="num">{g.calibrationIntervalDays} d</td>
                    <td>{fmtDate(g.lastCalibratedAt)}</td>
                    <td className={due ? "font-medium text-bad" : ""}>{fmtDate(g.nextDueAt) || "—"}</td>
                    <td>
                      <StatusBadge status={due ? "due" : g.status} />
                    </td>
                    <td>
                      <form action={calibrateGaugeAction} className="flex gap-1">
                        <input type="hidden" name="id" value={g.id} />
                        <Input name="date" type="date" defaultValue={t} className="w-36" />
                        <Button type="submit" size="sm" variant="secondary">
                          Calibrated
                        </Button>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {!rows.length ? (
                <tr>
                  <td colSpan={7} className="text-ink-3">
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
      </div>
    </>
  );
}
