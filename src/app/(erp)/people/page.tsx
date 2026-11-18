import { asc, eq, sql, and, gte } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { employees, laborEntries } from "@/lib/db/schema";
import { Card, PageHeader, Badge } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input } from "@/components/ui/fields";
import { saveEmployeeAction } from "@/modules/people/actions";
import { addDays, fmtMoney, fmtQty, today } from "@/lib/money";

export const metadata = { title: "People" };

export default async function PeoplePage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const since = new Date(`${addDays(today(), -7)}T00:00:00`);
  const [rows, hours] = await Promise.all([
    db.select().from(employees).where(eq(employees.orgId, ctx.orgId)).orderBy(asc(employees.name)),
    db
      .select({ employeeId: laborEntries.employeeId, hours: sql<number>`coalesce(sum(${laborEntries.hours}), 0)`.mapWith(Number) })
      .from(laborEntries)
      .where(and(eq(laborEntries.orgId, ctx.orgId), gte(laborEntries.startedAt, since)))
      .groupBy(laborEntries.employeeId),
  ]);
  return (
    <>
      <PageHeader title="Employees" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card padded={false} className="lg:col-span-2">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Badge</th>
                <th className="num">$ / hour</th>
                <th className="num">Hours, 7 days</th>
                <th>Skills</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="font-medium">{e.name}</td>
                  <td className="font-mono text-xs">{e.badge}</td>
                  <td className="num">{fmtMoney(e.hourlyRate)}</td>
                  <td className="num">{fmtQty(hours.find((h) => h.employeeId === e.id)?.hours ?? 0)}</td>
                  <td className="text-xs">{e.skills.join(", ")}</td>
                  <td>{e.active ? null : <Badge tone="bad">inactive</Badge>}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={6} className="text-ink-3">
                    No employees yet. Add the people who clock in.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
        <Card title="Add employee">
          <ActionForm action={saveEmployeeAction} className="space-y-3">
            <FormGrid cols={2}>
              <Field label="Name" className="md:col-span-2">
                <Input name="name" required />
              </Field>
              <Field label="Badge / short code">
                <Input name="badge" placeholder="PAT" />
              </Field>
              <Field label="Loaded $ / hour" hint="Wage plus burden; used for job cost">
                <Input name="hourlyRate" type="number" step="0.01" defaultValue={28} />
              </Field>
              <Field label="Skills (comma separated)" className="md:col-span-2">
                <Input name="skills" placeholder="CNC mill, deburr, final inspection" />
              </Field>
            </FormGrid>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
