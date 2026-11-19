import { asc, desc, eq, sql, and, gte } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { employeeTrainings, employees, laborEntries } from "@/lib/db/schema";
import { Card, PageHeader, Badge } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select } from "@/components/ui/fields";
import { addTrainingAction, deleteTrainingAction, saveEmployeeAction } from "@/modules/people/actions";
import { addDays, fmtDate, fmtMoney, fmtQty, today } from "@/lib/money";

export const metadata = { title: "People" };

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const t = today();
  const since = new Date(`${addDays(t, -7)}T00:00:00`);
  const [rows, hours, trainings] = await Promise.all([
    db.select().from(employees).where(eq(employees.orgId, ctx.orgId)).orderBy(asc(employees.name)),
    db
      .select({ employeeId: laborEntries.employeeId, hours: sql<number>`coalesce(sum(${laborEntries.hours}), 0)`.mapWith(Number) })
      .from(laborEntries)
      .where(and(eq(laborEntries.orgId, ctx.orgId), gte(laborEntries.startedAt, since)))
      .groupBy(laborEntries.employeeId),
    db.select().from(employeeTrainings).where(eq(employeeTrainings.orgId, ctx.orgId)).orderBy(desc(employeeTrainings.trainedAt)),
  ]);
  const editing = rows.find((e) => e.id === edit);
  const skills = [...new Set(rows.flatMap((e) => e.skills))].sort();
  const expiring = trainings.filter((tr) => tr.expiresAt && tr.expiresAt <= addDays(t, 60));
  const latest = (employeeId: string, skill: string) => trainings.find((tr) => tr.employeeId === employeeId && tr.skill === skill);
  return (
    <>
      <PageHeader title="Employees" description={`${rows.filter((e) => e.active).length} active · ${expiring.length} training records expiring within 60 days`} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Badge</th>
                  <th>Department</th>
                  <th>Shift</th>
                  <th className="num">$ / hour</th>
                  <th className="num">Hours, 7 days</th>
                  <th>Skills</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <a href={`/people?edit=${e.id}`} className="font-medium text-brand hover:underline">
                        {e.name}
                      </a>
                      {e.hireDate ? <div className="text-xs text-ink-3">since {fmtDate(e.hireDate)}</div> : null}
                    </td>
                    <td className="font-mono text-xs">{e.badge}</td>
                    <td>{e.department}</td>
                    <td>{e.shift}</td>
                    <td className="num">{fmtMoney(e.hourlyRate)}</td>
                    <td className="num">{fmtQty(hours.find((h) => h.employeeId === e.id)?.hours ?? 0)}</td>
                    <td className="text-xs">{e.skills.join(", ")}</td>
                    <td>{e.active ? null : <Badge tone="bad">inactive</Badge>}</td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={8} className="text-ink-3">
                      No employees yet. Add the people who clock in.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
          {skills.length ? (
            <Card title="Skills matrix" padded={false}>
              <div className="overflow-x-auto">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      {skills.map((s) => (
                        <th key={s}>{s}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .filter((e) => e.active)
                      .map((e) => (
                        <tr key={e.id}>
                          <td className="font-medium">{e.name}</td>
                          {skills.map((s) => {
                            const has = e.skills.includes(s);
                            const tr = latest(e.id, s);
                            const expired = tr?.expiresAt && tr.expiresAt < t;
                            const soon = tr?.expiresAt && !expired && tr.expiresAt <= addDays(t, 60);
                            return (
                              <td key={s} className={`text-center text-xs ${expired ? "bg-bad-soft text-bad" : soon ? "bg-warn-soft text-warn" : has ? "bg-good-soft text-good" : "text-ink-3"}`} title={tr ? `Trained ${fmtDate(tr.trainedAt)}${tr.expiresAt ? `, expires ${fmtDate(tr.expiresAt)}` : ""}` : undefined}>
                                {has ? (tr?.expiresAt ? fmtDate(tr.expiresAt) : "✓") : ""}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <p className="px-3 py-2 text-xs text-ink-3">Green: qualified. Amber: expires within 60 days. Red: expired. Dates come from training records.</p>
            </Card>
          ) : null}
          <Card title="Training records" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Skill</th>
                  <th>Trained</th>
                  <th>Expires</th>
                  <th>Trainer</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {trainings.slice(0, 60).map((tr) => (
                  <tr key={tr.id}>
                    <td>{rows.find((e) => e.id === tr.employeeId)?.name}</td>
                    <td>{tr.skill}</td>
                    <td>{fmtDate(tr.trainedAt)}</td>
                    <td className={tr.expiresAt && tr.expiresAt < t ? "text-bad" : ""}>{fmtDate(tr.expiresAt) || "—"}</td>
                    <td>{tr.trainer}</td>
                    <td className="text-ink-3">{tr.notes}</td>
                    <td>
                      <form action={deleteTrainingAction}>
                        <input type="hidden" name="id" value={tr.id} />
                        <button className="text-xs text-ink-3 hover:text-bad" type="submit">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {!trainings.length ? (
                  <tr>
                    <td colSpan={7} className="text-ink-3">
                      No training records yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <ActionForm action={addTrainingAction} className="flex flex-wrap items-end gap-2 border-t border-line p-3">
              <div className="w-44">
                <span className="mb-1 block text-xs text-ink-2">Employee</span>
                <Select name="employeeId" required defaultValue="">
                  <option value="">Select</option>
                  {rows.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-40">
                <span className="mb-1 block text-xs text-ink-2">Skill</span>
                <Input name="skill" list="skills" required />
                <datalist id="skills">
                  {skills.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div className="w-36">
                <span className="mb-1 block text-xs text-ink-2">Trained on</span>
                <Input name="trainedAt" type="date" defaultValue={t} required />
              </div>
              <div className="w-36">
                <span className="mb-1 block text-xs text-ink-2">Expires</span>
                <Input name="expiresAt" type="date" />
              </div>
              <div className="w-32">
                <span className="mb-1 block text-xs text-ink-2">Trainer</span>
                <Input name="trainer" />
              </div>
              <SubmitButton size="sm" variant="secondary">
                Add record
              </SubmitButton>
            </ActionForm>
          </Card>
        </div>
        <Card title={editing ? `Edit ${editing.name}` : "Add employee"}>
          <ActionForm key={editing?.id ?? "new"} action={saveEmployeeAction} className="space-y-3">
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
            <FormGrid cols={2}>
              <Field label="Name" className="md:col-span-2">
                <Input name="name" required defaultValue={editing?.name ?? ""} />
              </Field>
              <Field label="Badge / short code">
                <Input name="badge" placeholder="PAT" defaultValue={editing?.badge ?? ""} />
              </Field>
              <Field label="Loaded $ / hour" hint="Wage plus burden; used for job cost">
                <Input name="hourlyRate" type="number" step="0.01" defaultValue={editing?.hourlyRate ?? 28} />
              </Field>
              <Field label="Department">
                <Input name="department" placeholder="Machining, assembly…" defaultValue={editing?.department ?? ""} />
              </Field>
              <Field label="Shift">
                <Input name="shift" placeholder="Day, 2nd…" defaultValue={editing?.shift ?? ""} />
              </Field>
              <Field label="Hire date">
                <Input name="hireDate" type="date" defaultValue={editing?.hireDate ?? ""} />
              </Field>
              <Field label="Phone">
                <Input name="phone" defaultValue={editing?.phone ?? ""} />
              </Field>
              <Field label="Email" className="md:col-span-2">
                <Input name="email" type="email" defaultValue={editing?.email ?? ""} />
              </Field>
              <Field label="Skills (comma separated)" className="md:col-span-2">
                <Input name="skills" placeholder="CNC mill, deburr, final inspection" defaultValue={editing?.skills.join(", ") ?? ""} />
              </Field>
            </FormGrid>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={editing?.active ?? true} /> Active
            </label>
            <div className="flex gap-2">
              <SubmitButton>{editing ? "Save changes" : "Save"}</SubmitButton>
              {editing ? (
                <a href="/people" className="inline-flex h-9 items-center rounded border border-line bg-white px-3 text-sm hover:bg-paper">
                  Cancel
                </a>
              ) : null}
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
