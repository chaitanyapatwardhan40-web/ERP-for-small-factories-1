import { eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { orgs } from "@/lib/db/schema";
import { pickCustomers, pickItems } from "@/lib/pick";
import { Card, PageHeader } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/fields";
import { LineEditor } from "@/components/forms/line-editor";
import { createQuoteAction } from "@/modules/sales/actions";
import { addDays, today } from "@/lib/money";

export const metadata = { title: "New quote" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const { customerId } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const [customerList, itemList, [org]] = await Promise.all([pickCustomers(db, ctx.orgId), pickItems(db, ctx.orgId), db.select().from(orgs).where(eq(orgs.id, ctx.orgId))]);
  return (
    <>
      <PageHeader title="New quote" crumbs={[{ href: "/quotes", label: "Quotes" }]} />
      <ActionForm action={createQuoteAction} className="space-y-4">
        <Card>
          <FormGrid cols={4}>
            <Field label="Customer">
              <Select name="customerId" required defaultValue={customerId ?? ""}>
                <option value="">Select customer</option>
                {customerList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quote date">
              <Input name="quoteDate" type="date" defaultValue={today()} required />
            </Field>
            <Field label="Valid until">
              <Input name="validUntil" type="date" defaultValue={addDays(today(), 30)} />
            </Field>
            <Field label="Customer RFQ #">
              <Input name="customerRfq" />
            </Field>
          </FormGrid>
        </Card>
        <Card title="Lines">
          <LineEditor items={itemList} mode="quote" defaultMarginPct={org?.settings.defaultMarginPct ?? 30} overheadPct={org?.settings.overheadPct ?? 0} />
        </Card>
        <Card>
          <Field label="Notes (printed on the quote)">
            <Textarea name="notes" />
          </Field>
        </Card>
        <SubmitButton>Create quote</SubmitButton>
      </ActionForm>
    </>
  );
}
