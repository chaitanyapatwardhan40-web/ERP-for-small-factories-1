import { asc, desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { inspectionPlans, inspections, items, users } from "@/lib/db/schema";
import { pickItems } from "@/lib/pick";
import { Card, PageHeader, Tabs, StatusBadge } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/fields";
import { recordInspectionAction, savePlanAction } from "@/modules/quality/actions";
import { fmtDateTime, fmtQty } from "@/lib/money";
import { QUALITY_TABS } from "./tabs";
import { InspectionChecklist } from "@/components/forms/inspection-checklist";

export const metadata = { title: "Quality" };

export default async function QualityPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan: planId } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const [plans, recent, itemList] = await Promise.all([
    db.select({ p: inspectionPlans, sku: items.sku }).from(inspectionPlans).leftJoin(items, eq(items.id, inspectionPlans.itemId)).where(eq(inspectionPlans.orgId, ctx.orgId)).orderBy(asc(inspectionPlans.name)),
    db.select({ i: inspections, sku: items.sku, by: users.name }).from(inspections).leftJoin(items, eq(items.id, inspections.itemId)).leftJoin(users, eq(users.id, inspections.inspectedBy)).where(eq(inspections.orgId, ctx.orgId)).orderBy(desc(inspections.inspectedAt)).limit(50),
    pickItems(db, ctx.orgId),
  ]);
  const selected = plans.find((p) => p.p.id === planId) ?? plans[0];
  const passRate = recent.length ? Math.round((recent.filter((r) => r.i.result === "pass").length / recent.length) * 100) : null;
  return (
    <>
      <PageHeader title="Inspections" description={`Incoming, in-process and final checks against a plan. ${passRate === null ? "" : `Pass rate on the last ${recent.length}: ${passRate}%.`}`} />
      <Tabs tabs={QUALITY_TABS} current="/quality" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Record an inspection">
            {plans.length ? (
              <>
                <form className="mb-3 flex items-center gap-2 text-sm">
                  <span className="text-ink-3">Plan</span>
                  <select name="plan" defaultValue={selected?.p.id} className="rounded-md border border-line bg-white px-2 py-1 text-sm">
                    {plans.map((p) => (
                      <option key={p.p.id} value={p.p.id}>
                        {p.p.name} ({p.p.stage}{p.sku ? ` · ${p.sku}` : ""})
                      </option>
                    ))}
                  </select>
                  <button className="rounded-md border border-line bg-white px-2 py-1 text-xs">Load</button>
                </form>
                {selected ? (
                  <ActionForm action={recordInspectionAction} className="space-y-3">
                    <input type="hidden" name="planId" value={selected.p.id} />
                    <input type="hidden" name="stage" value={selected.p.stage} />
                    <FormGrid cols={4}>
                      <Field label="Item">
                        <Select name="itemId" defaultValue={selected.p.itemId ?? ""}>
                          <option value="">—</option>
                          {itemList.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.sku}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Reference (WO, receipt, lot)">
                        <Input name="refType" placeholder="WO-00012 / lot 24A" />
                      </Field>
                      <Field label="Qty inspected">
                        <Input name="qtyInspected" type="number" step="1" defaultValue={selected.p.sampleSize} />
                      </Field>
                      <Field label="Qty rejected">
                        <Input name="qtyRejected" type="number" step="1" defaultValue={0} />
                      </Field>
                    </FormGrid>
                    <InspectionChecklist checklist={selected.p.checklist} />
                    <Field label="Notes">
                      <Textarea name="notes" className="min-h-12" />
                    </Field>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="openNcr" defaultChecked /> Open an NCR automatically if it fails
                    </label>
                    <SubmitButton>Record result</SubmitButton>
                  </ActionForm>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-ink-3">Create an inspection plan first (right).</p>
            )}
          </Card>
          <Card title="Recent inspections" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Stage</th>
                  <th>Item</th>
                  <th>Ref</th>
                  <th className="num">Inspected</th>
                  <th className="num">Rejected</th>
                  <th>Result</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(({ i, sku, by }) => (
                  <tr key={i.id}>
                    <td className="text-xs">{fmtDateTime(i.inspectedAt)}</td>
                    <td>{i.stage.replace("_", " ")}</td>
                    <td>{sku}</td>
                    <td className="text-xs text-ink-3">{i.refType}</td>
                    <td className="num">{fmtQty(i.qtyInspected)}</td>
                    <td className="num">{fmtQty(i.qtyRejected)}</td>
                    <td>
                      <StatusBadge status={i.result} />
                    </td>
                    <td>{by}</td>
                  </tr>
                ))}
                {!recent.length ? (
                  <tr>
                    <td colSpan={8} className="text-ink-3">
                      No inspections yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Plans">
            {plans.length ? (
              <ul className="mb-3 space-y-1 text-sm">
                {plans.map((p) => (
                  <li key={p.p.id}>
                    <span className="font-medium">{p.p.name}</span> <span className="text-ink-3">· {p.p.stage.replace("_", " ")}{p.sku ? ` · ${p.sku}` : " · any item"} · {p.p.checklist.length} checks</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <ActionForm action={savePlanAction} className="space-y-2">
              <Input name="name" placeholder="Plan name (Final inspection – kits)" required />
              <div className="grid grid-cols-2 gap-2">
                <Select name="stage" defaultValue="final">
                  <option value="incoming">Incoming</option>
                  <option value="in_process">In process</option>
                  <option value="final">Final</option>
                </Select>
                <Select name="itemId" defaultValue="">
                  <option value="">Any item</option>
                  {itemList.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.sku}
                    </option>
                  ))}
                </Select>
              </div>
              <Input name="sampleSize" type="number" defaultValue={1} placeholder="Sample size" />
              {[0, 1, 2, 3].map((n) => (
                <div key={n} className="grid grid-cols-[1fr_5rem_4rem_4rem] gap-1">
                  <Input name={`checks[${n}][name]`} placeholder={n === 0 ? "Check (e.g. OD 25.00)" : "Check"} />
                  <Select name={`checks[${n}][type]`} defaultValue="visual">
                    <option value="visual">visual</option>
                    <option value="measurement">measure</option>
                    <option value="document">document</option>
                  </Select>
                  <Input name={`checks[${n}][min]`} type="number" step="0.001" placeholder="min" />
                  <Input name={`checks[${n}][max]`} type="number" step="0.001" placeholder="max" />
                </div>
              ))}
              <SubmitButton variant="secondary" className="w-full">
                Add plan
              </SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
