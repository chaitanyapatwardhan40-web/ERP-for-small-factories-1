import Link from "@/components/ui/link";
import { asc, desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { campaigns, leads, orgs, LEAD_STAGES } from "@/lib/db/schema";
import { draftReactivationEmail, reactivationRadar } from "@/modules/crm/service";
import { Card, PageHeader, Stat, StatusBadge } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/fields";
import { leadStageAction, saveCampaignAction, saveLeadAction } from "@/modules/crm/actions";
import { fmtDate, fmtMoney } from "@/lib/money";

export const metadata = { title: "Leads and marketing" };

export default async function CrmPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const [rows, radar, camps, [org]] = await Promise.all([
    db.select().from(leads).where(eq(leads.orgId, ctx.orgId)).orderBy(asc(leads.nextActionAt), desc(leads.createdAt)),
    reactivationRadar(db, ctx.orgId, 180),
    db.select().from(campaigns).where(eq(campaigns.orgId, ctx.orgId)).orderBy(desc(campaigns.createdAt)).limit(10),
    db.select().from(orgs).where(eq(orgs.id, ctx.orgId)),
  ]);
  const openLeads = rows.filter((l) => !["won", "lost"].includes(l.stage));
  const pipeline = openLeads.reduce((s, l) => s + Number(l.estimatedValue), 0);
  const draft = radar.length ? draftReactivationEmail(org?.name ?? "Our shop", radar[0].customer.name, radar[0].usedToBuy, radar[0].daysQuiet) : null;
  return (
    <>
      <PageHeader title="Leads" />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Open leads" value={openLeads.length} hint={fmtMoney(pipeline)} />
        <Stat label="Quiet customers" value={radar.length} hint="no order in 6 months" tone={radar.length ? "warn" : undefined} />
        <Stat label="Won / lost" value={`${rows.filter((l) => l.stage === "won").length} / ${rows.filter((l) => l.stage === "lost").length}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Pipeline" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Source</th>
                  <th className="num">Est. value</th>
                  <th>Next action</th>
                  <th>Stage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link href={`/crm/${l.id}`} className="font-medium text-brand hover:underline">
                        {l.company}
                      </Link>
                    </td>
                    <td>
                      {l.contactName}
                      {l.email ? <div className="text-xs text-ink-3">{l.email}</div> : null}
                    </td>
                    <td>{l.source}</td>
                    <td className="num">{fmtMoney(l.estimatedValue)}</td>
                    <td className="text-xs">
                      {l.nextAction}
                      {l.nextActionAt ? <div className="text-ink-3">{fmtDate(l.nextActionAt)}</div> : null}
                    </td>
                    <td>
                      <form action={leadStageAction} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={l.id} />
                        <select name="stage" defaultValue={l.stage} className="rounded border border-line bg-white px-1 py-0.5 text-xs">
                          {LEAD_STAGES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <input name="lostReason" placeholder="If lost, why" className="w-28 rounded border border-line px-1 py-0.5 text-xs" />
                        <button className="text-xs text-brand hover:underline" type="submit">
                          set
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={6} className="text-ink-3">
                      No leads yet. Add the RFQ that came in this morning.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
          <Card title="Reactivation radar" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Last order</th>
                  <th className="num">Quiet</th>
                  <th className="num">Orders</th>
                  <th className="num">Lifetime</th>
                  <th>Used to buy</th>
                </tr>
              </thead>
              <tbody>
                {radar.map((r) => (
                  <tr key={r.customer.id}>
                    <td>
                      <Link href={`/customers/${r.customer.id}`} className="font-medium text-brand hover:underline">
                        {r.customer.name}
                      </Link>
                    </td>
                    <td>{fmtDate(r.lastOrder)}</td>
                    <td className="num">{r.daysQuiet} d</td>
                    <td className="num">{r.orders}</td>
                    <td className="num">{fmtMoney(r.revenue)}</td>
                    <td className="font-mono text-xs">{r.usedToBuy.join(", ")}</td>
                  </tr>
                ))}
                {!radar.length ? (
                  <tr>
                    <td colSpan={6} className="text-ink-3">
                      Every customer with order history has ordered in the last 6 months.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
          {radar.length ? (
            <Card title="Reactivation campaign">
              <ActionForm action={saveCampaignAction} className="space-y-2">
                <input type="hidden" name="type" value="reactivation" />
                <Input name="name" defaultValue={`Reactivation · ${fmtDate(new Date())}`} required />
                <Input name="subject" defaultValue={draft?.subject} required />
                <Textarea name="body" defaultValue={draft?.body} className="min-h-40" required />
                <div className="flex flex-wrap gap-2 text-xs">
                  {radar.map((r) => (
                    <label key={r.customer.id} className="flex items-center gap-1 rounded-full border border-line bg-white px-2 py-1">
                      <input type="checkbox" name="customerId" value={r.customer.id} defaultChecked /> {r.customer.name}
                    </label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <SubmitButton variant="secondary">Save draft</SubmitButton>
                  <SubmitButton name="send" value="1">
                    Mark as sent
                  </SubmitButton>
                </div>
                <p className="text-xs text-ink-3">Copy the draft into your mail client to send it.</p>
              </ActionForm>
            </Card>
          ) : null}
        </div>
        <div className="space-y-4">
          <Card title="New lead">
            <ActionForm action={saveLeadAction} className="space-y-2">
              <Input name="company" placeholder="Company" required />
              <Input name="contactName" placeholder="Contact" />
              <div className="grid grid-cols-2 gap-2">
                <Input name="email" type="email" placeholder="Email" />
                <Input name="phone" placeholder="Phone" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select name="source" defaultValue="referral">
                  <option value="referral">Referral</option>
                  <option value="website">Website RFQ</option>
                  <option value="trade_show">Trade show</option>
                  <option value="cold">Cold outreach</option>
                  <option value="existing">Existing customer</option>
                </Select>
                <Input name="estimatedValue" type="number" step="100" placeholder="Est. value" />
              </div>
              <Input name="nextAction" placeholder="Next action (call back Tuesday)" />
              <div className="grid grid-cols-2 gap-2">
                <Input name="nextActionAt" type="date" title="Next action date" />
                <Input name="expectedClose" type="date" title="Expected close" />
              </div>
              <Textarea name="notes" placeholder="Notes" className="min-h-12" />
              <SubmitButton className="w-full">Add lead</SubmitButton>
            </ActionForm>
          </Card>
          {camps.length ? (
            <Card title="Campaigns">
              <ul className="space-y-1 text-sm">
                {camps.map((c) => (
                  <li key={c.id} className="flex items-center justify-between">
                    <span>
                      {c.name} <span className="text-xs text-ink-3">· {c.audience.length} customers</span>
                    </span>
                    <StatusBadge status={c.status} />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
