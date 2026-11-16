import Link from "next/link";
import { uuidOr404 } from "@/lib/ids";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { activities, contacts, leads, LEAD_STAGES } from "@/lib/db/schema";
import { Card, PageHeader, StatusBadge } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/fields";
import { convertLeadAction, saveLeadAction } from "@/modules/crm/actions";
import { ActivityCard, ContactsCard } from "@/components/forms/party-side";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [l] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.orgId, ctx.orgId)));
  if (!l) notFound();
  const [cts, acts] = await Promise.all([
    db.select().from(contacts).where(and(eq(contacts.partyType, "lead"), eq(contacts.partyId, l.id))),
    db.select().from(activities).where(and(eq(activities.partyType, "lead"), eq(activities.partyId, l.id))).orderBy(desc(activities.at)),
  ]);
  return (
    <>
      <PageHeader
        title={l.company}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={l.stage} />
            {l.customerId ? (
              <Link href={`/customers/${l.customerId}`} className="text-brand hover:underline">
                customer record
              </Link>
            ) : null}
          </span>
        }
        crumbs={[{ href: "/crm", label: "Leads" }]}
        actions={
          <form action={convertLeadAction}>
            <input type="hidden" name="id" value={l.id} />
            <Button type="submit">{l.customerId ? "New quote" : "Convert to customer and quote"}</Button>
          </form>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Lead" className="lg:col-span-2">
          <ActionForm action={saveLeadAction} className="space-y-3">
            <input type="hidden" name="id" value={l.id} />
            <FormGrid cols={3}>
              <Field label="Company">
                <Input name="company" defaultValue={l.company} required />
              </Field>
              <Field label="Contact">
                <Input name="contactName" defaultValue={l.contactName ?? ""} />
              </Field>
              <Field label="Stage">
                <Select name="stage" defaultValue={l.stage}>
                  {LEAD_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Email">
                <Input name="email" defaultValue={l.email ?? ""} />
              </Field>
              <Field label="Phone">
                <Input name="phone" defaultValue={l.phone ?? ""} />
              </Field>
              <Field label="Source">
                <Input name="source" defaultValue={l.source ?? ""} />
              </Field>
              <Field label="Estimated value">
                <Input name="estimatedValue" type="number" step="100" defaultValue={l.estimatedValue} />
              </Field>
              <Field label="Next action">
                <Input name="nextAction" defaultValue={l.nextAction ?? ""} />
              </Field>
              <Field label="Next action date">
                <Input name="nextActionAt" type="date" defaultValue={l.nextActionAt ? l.nextActionAt.toISOString().slice(0, 10) : ""} />
              </Field>
            </FormGrid>
            <Field label="Notes">
              <Textarea name="notes" defaultValue={l.notes ?? ""} />
            </Field>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </Card>
        <div className="space-y-4">
          <ContactsCard partyType="lead" partyId={l.id} rows={cts} />
          <ActivityCard partyType="lead" partyId={l.id} rows={acts} />
        </div>
      </div>
    </>
  );
}
