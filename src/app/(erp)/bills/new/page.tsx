import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { pickVendors } from "@/lib/pick";
import { Card, PageHeader } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select } from "@/components/ui/fields";
import { expenseBillAction } from "@/modules/purchasing/actions";
import { today } from "@/lib/money";

export const metadata = { title: "New expense bill" };

export default async function NewBillPage({ searchParams }: { searchParams: Promise<{ vendorId?: string }> }) {
  const { vendorId } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const vendorList = await pickVendors(db, ctx.orgId);
  return (
    <>
      <PageHeader title="New expense bill" crumbs={[{ href: "/bills", label: "Vendor bills" }]} description="For bills with no purchase order. Bills for received goods are created from the PO." />
      <Card>
        <ActionForm action={expenseBillAction} className="space-y-4">
          <FormGrid cols={3}>
            <Field label="Vendor">
              <Select name="vendorId" required defaultValue={vendorId ?? ""}>
                <option value="">Select vendor</option>
                {vendorList.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Bill date">
              <Input name="billDate" type="date" defaultValue={today()} required />
            </Field>
            <Field label="Due date" hint="Blank = vendor terms">
              <Input name="dueDate" type="date" />
            </Field>
            <Field label="Vendor invoice #">
              <Input name="vendorRef" />
            </Field>
            <Field label="Description">
              <Input name="description" required placeholder="November rent" />
            </Field>
            <Field label="Amount">
              <Input name="amount" type="number" step="0.01" required />
            </Field>
            <Field label="Expense account">
              <Select name="expenseSubtype" defaultValue="operating_expense">
                <option value="operating_expense">Operating expenses</option>
                <option value="payroll_expense">Payroll expense</option>
                <option value="fixed_assets">Machinery and equipment (capitalise)</option>
                <option value="scrap_expense">Scrap</option>
                <option value="other">Other</option>
              </Select>
            </Field>
          </FormGrid>
          <SubmitButton>Record bill</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
