import { asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { workCenters } from "@/lib/db/schema";
import { Card, PageHeader, Tabs, Badge } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input } from "@/components/ui/fields";
import { saveWorkCenterAction } from "@/modules/items/actions";
import { fmtMoney, fmtQty } from "@/lib/money";
import { ITEM_TABS } from "../tabs";

export const metadata = { title: "Work centers" };

export default async function WorkCentersPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const rows = await db.select().from(workCenters).where(eq(workCenters.orgId, ctx.orgId)).orderBy(asc(workCenters.code));
  return (
    <>
      <PageHeader title="Work centers" description="Machines or cells with an hourly rate and daily capacity. Routing operations run here." />
      <Tabs tabs={ITEM_TABS} current="/items/work-centers" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card padded={false} className="lg:col-span-2">
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th className="num">$ / hour</th>
                <th className="num">Hours / day</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  <td className="font-mono text-xs">{w.code}</td>
                  <td>{w.name}</td>
                  <td className="num">{fmtMoney(w.hourlyRate)}</td>
                  <td className="num">{fmtQty(w.capacityHoursPerDay)}</td>
                  <td>{w.active ? null : <Badge tone="bad">inactive</Badge>}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={5} className="text-ink-3">
                    No work centers yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
        <Card title="Add or update">
          <ActionForm action={saveWorkCenterAction} className="space-y-3">
            <FormGrid cols={2}>
              <Field label="Code">
                <Input name="code" required placeholder="CNC1" />
              </Field>
              <Field label="Name">
                <Input name="name" required placeholder="Haas VF-2" />
              </Field>
              <Field label="$ per hour">
                <Input name="hourlyRate" type="number" step="0.01" defaultValue={60} />
              </Field>
              <Field label="Hours per day">
                <Input name="capacityHoursPerDay" type="number" step="0.5" defaultValue={8} />
              </Field>
            </FormGrid>
            <p className="text-xs text-ink-3">To update an existing work center, enter its code again with new values.</p>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
