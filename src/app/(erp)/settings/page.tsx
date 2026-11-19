import { desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { auditLog, memberships, orgs, users, ROLES } from "@/lib/db/schema";
import { Card, PageHeader, Badge } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/fields";
import { AddressFields } from "@/components/forms/address-fields";
import { changePasswordAction, changeRoleAction, inviteMemberAction, removeMemberAction, updateSettingsAction } from "@/modules/platform/actions";
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
                <Field label="Over-receipt allowed %" hint="How far a receipt may exceed the PO quantity">
                  <Input name="overReceiptPct" type="number" step="0.1" min="0" defaultValue={s.overReceiptPct ?? 0} />
                </Field>
              </FormGrid>
              <fieldset className="space-y-3 rounded border border-line p-3">
                <legend className="px-1 text-xs font-medium text-ink-2">Company (printed on quotes, POs, invoices)</legend>
                <FormGrid cols={3}>
                  <Field label="Legal name" className="md:col-span-3">
                    <Input name="legalName" defaultValue={s.company?.legalName ?? ""} placeholder={org.name} />
                  </Field>
                  <Field label="Phone">
                    <Input name="phone" defaultValue={s.company?.phone ?? ""} />
                  </Field>
                  <Field label="Email">
                    <Input name="email" type="email" defaultValue={s.company?.email ?? ""} />
                  </Field>
                  <Field label="Website">
                    <Input name="website" defaultValue={s.company?.website ?? ""} />
                  </Field>
                  <Field label="Tax ID / EIN">
                    <Input name="taxId" defaultValue={s.company?.taxId ?? ""} />
                  </Field>
                </FormGrid>
                <AddressFields prefix="co" value={s.company?.address} title="Address (default ship-to on purchase orders)" />
              </fieldset>
              <fieldset className="space-y-3 rounded border border-line p-3">
                <legend className="px-1 text-xs font-medium text-ink-2">Standard text on documents</legend>
                <FormGrid cols={2}>
                  <Field label="Quote terms">
                    <Textarea name="quoteTerms" defaultValue={s.documents?.quoteTerms ?? ""} placeholder="Prices valid 30 days. Lead time from receipt of order…" />
                  </Field>
                  <Field label="Purchase order terms">
                    <Textarea name="poTerms" defaultValue={s.documents?.poTerms ?? ""} placeholder="Certs of conformance required with each shipment…" />
                  </Field>
                  <Field label="Invoice terms">
                    <Textarea name="invoiceTerms" defaultValue={s.documents?.invoiceTerms ?? ""} placeholder="1.5% per month on balances past due…" />
                  </Field>
                  <Field label="Invoice footer">
                    <Textarea name="invoiceFooter" defaultValue={s.documents?.invoiceFooter ?? ""} placeholder="Remit to…" />
                  </Field>
                </FormGrid>
              </fieldset>
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
                    {m.userId !== ctx.userId ? (
                      <form action={changeRoleAction} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={m.id} />
                        <select name="role" defaultValue={m.role} className="rounded border border-line bg-white px-1 py-0.5 text-xs">
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="text-xs text-brand hover:underline">
                          set
                        </button>
                      </form>
                    ) : (
                      <Badge tone="info">{m.role}</Badge>
                    )}
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
            <ActionForm action={inviteMemberAction} className="space-y-2">
              <Input name="name" placeholder="Name" required />
              <Input name="email" type="email" placeholder="Email" required />
              <div className="grid grid-cols-2 gap-2">
                <Select name="role" defaultValue="office">
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
                <Input name="password" type="text" placeholder="Temporary password" required minLength={8} />
              </div>
              <SubmitButton variant="secondary" className="w-full">
                Add person
              </SubmitButton>
            </ActionForm>
            <p className="mt-2 text-xs text-ink-3">Creates the account if the email is new; they change the password after signing in. Owner: all. Office: sell, buy, make. Shop: floor and stock. Accountant: books. Read-only.</p>
          </Card>
          <Card title="Your password">
            <ActionForm action={changePasswordAction} className="space-y-2">
              <Input name="current" type="password" placeholder="Current password" autoComplete="current-password" required />
              <Input name="next" type="password" placeholder="New password (8+ characters)" autoComplete="new-password" required minLength={8} />
              <Input name="confirm" type="password" placeholder="Repeat new password" autoComplete="new-password" required />
              <SubmitButton variant="secondary" className="w-full">
                Change password
              </SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
