import { desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { auditLog, memberships, orgs, users, ROLES } from "@/lib/db/schema";
import { Card, PageHeader, Badge } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select } from "@/components/ui/fields";
import { addMemberAction, removeMemberAction, updateSettingsAction } from "@/modules/platform/actions";
import { fmtDateTime } from "@/lib/money";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const [[org], members, recent] = await Promise.all([
    db.select().from(orgs).where(eq(orgs.id, ctx.orgId)),
    db.select({ m: memberships, name: users.name, email: users.email }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.orgId, ctx.orgId)),
    db.select({ a: auditLog, who: users.name }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId)).where(eq(auditLog.orgId, ctx.orgId)).orderBy(desc(auditLog.createdAt)).limit(40),
  ]);
  const s = org.settings;
  return (
    <>
      <PageHeader title="Settings" description={org.name} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Shop">
            <ActionForm action={updateSettingsAction} className="space-y-3">
              <FormGrid cols={3}>
                <Field label="Shop name" className="md:col-span-3">
                  <Input name="name" defaultValue={org.name} required />
                </Field>
                <Field label="Currency">
                  <Input name="currency" defaultValue={s.currency ?? "USD"} maxLength={3} />
                </Field>
                <Field label="Default terms (days)">
                  <Input name="defaultTermsDays" type="number" defaultValue={s.defaultTermsDays ?? 30} />
                </Field>
                <Field label="Default sales tax %">
                  <Input name="defaultTaxRatePct" type="number" step="0.01" defaultValue={s.defaultTaxRatePct ?? 0} />
                </Field>
                <Field label="Overhead % of labour" hint="Applied to work orders at completion and in cost roll-ups">
                  <Input name="overheadPct" type="number" step="0.1" defaultValue={s.overheadPct ?? 0} />
                </Field>
                <Field label="Default quote margin %">
                  <Input name="defaultMarginPct" type="number" step="0.1" defaultValue={s.defaultMarginPct ?? 30} />
                </Field>
              </FormGrid>
              <SubmitButton>Save settings</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Audit log" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Record</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(({ a, who }) => (
                  <tr key={a.id}>
                    <td className="text-xs">{fmtDateTime(a.createdAt)}</td>
                    <td>{who ?? "system"}</td>
                    <td className="font-mono text-xs">{a.action}</td>
                    <td className="text-xs text-ink-3">{a.entityType}</td>
                  </tr>
                ))}
                {!recent.length ? (
                  <tr>
                    <td colSpan={4} className="text-ink-3">
                      Nothing yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="People with access">
            <ul className="mb-3 space-y-1.5 text-sm">
              {members.map(({ m, name, email }) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-medium">{name}</span> <span className="text-xs text-ink-3">{email}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={m.role === "owner" ? "info" : "neutral"}>{m.role}</Badge>
                    {m.userId !== ctx.userId ? (
                      <form action={removeMemberAction}>
                        <input type="hidden" name="id" value={m.id} />
                        <Button type="submit" size="sm" variant="ghost">
                          remove
                        </Button>
                      </form>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <ActionForm action={addMemberAction} className="space-y-2">
              <Input name="email" type="email" placeholder="Email of a registered user" required />
              <Select name="role" defaultValue="office">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
              <SubmitButton variant="secondary" className="w-full">
                Add to shop
              </SubmitButton>
            </ActionForm>
            <p className="mt-2 text-xs text-ink-3">Owner: all. Office: sell, buy, make. Shop: floor and stock. Accountant: books. Read-only.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
