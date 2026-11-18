import { asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { accounts, ACCOUNT_SUBTYPES, periods, postingRules } from "@/lib/db/schema";
import { Card, PageHeader, Tabs, Badge } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select } from "@/components/ui/fields";
import { saveAccountAction, savePostingRuleAction, togglePeriodAction } from "@/modules/books/actions";
import { fmtDate } from "@/lib/money";
import { BOOKS_TABS } from "../tabs";

export const metadata = { title: "Chart of accounts" };

export default async function AccountsPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const [accts, rules, pds] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.orgId, ctx.orgId)).orderBy(asc(accounts.code)),
    db.select().from(postingRules).where(eq(postingRules.orgId, ctx.orgId)).orderBy(asc(postingRules.event)),
    db.select().from(periods).where(eq(periods.orgId, ctx.orgId)).orderBy(asc(periods.startDate)),
  ]);
  const SubtypeSelect = ({ name, value }: { name: string; value: string }) => (
    <select name={name} defaultValue={value} className="rounded border border-line bg-white px-2 py-1 text-xs">
      {ACCOUNT_SUBTYPES.map((s) => (
        <option key={s} value={s}>
          {s.replaceAll("_", " ")}
        </option>
      ))}
    </select>
  );
  return (
    <>
      <PageHeader title="Chart of accounts" />
      <Tabs tabs={BOOKS_TABS} current="/books/accounts" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Chart of accounts" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Subtype (what rules post to)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {accts.map((a) => (
                  <tr key={a.id}>
                    <td className="font-mono text-xs">{a.code}</td>
                    <td>{a.name}</td>
                    <td className="text-ink-3">{a.type}</td>
                    <td className="text-ink-3">{a.subtype.replaceAll("_", " ")}</td>
                    <td>{a.active ? null : <Badge tone="bad">inactive</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Posting rules" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Debit</th>
                  <th>Credit</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="font-mono text-xs">{r.event}</div>
                      <div className="text-xs text-ink-3">{r.description}</div>
                    </td>
                    <td colSpan={3}>
                      <ActionForm action={savePostingRuleAction} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={r.id} />
                        <SubtypeSelect name="debitSubtype" value={r.debitSubtype} />
                        <span className="text-xs text-ink-3">/</span>
                        <SubtypeSelect name="creditSubtype" value={r.creditSubtype} />
                        <SubmitButton size="sm" variant="ghost">
                          Save
                        </SubmitButton>
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Add account">
            <ActionForm action={saveAccountAction} className="space-y-3">
              <FormGrid cols={2}>
                <Field label="Code">
                  <Input name="code" required placeholder="6200" />
                </Field>
                <Field label="Name">
                  <Input name="name" required />
                </Field>
                <Field label="Type">
                  <Select name="type" defaultValue="expense">
                    <option value="asset">Asset</option>
                    <option value="liability">Liability</option>
                    <option value="equity">Equity</option>
                    <option value="revenue">Revenue</option>
                    <option value="expense">Expense</option>
                  </Select>
                </Field>
                <Field label="Subtype">
                  <Select name="subtype" defaultValue="other">
                    {ACCOUNT_SUBTYPES.map((s) => (
                      <option key={s} value={s}>
                        {s.replaceAll("_", " ")}
                      </option>
                    ))}
                  </Select>
                </Field>
              </FormGrid>
              <SubmitButton>Save account</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Periods" padded={false}>
            <table className="data">
              <tbody>
                {pds.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="text-xs text-ink-3">
                      {fmtDate(p.startDate)} – {fmtDate(p.endDate)}
                    </td>
                    <td className="text-right">
                      <form action={togglePeriodAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <Button type="submit" size="sm" variant={p.locked ? "secondary" : "ghost"}>
                          {p.locked ? "Locked · unlock" : "Lock"}
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </>
  );
}
