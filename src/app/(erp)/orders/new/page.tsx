import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { pickCustomers, pickItems } from "@/lib/pick";
import { Card, PageHeader } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/fields";
import { LineEditor } from "@/components/forms/line-editor";
import { createOrderAction } from "@/modules/sales/actions";
import { addDays, today } from "@/lib/money";

export const metadata = { title: "New sales order" };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const { customerId } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const [customerList, itemList] = await Promise.all([pickCustomers(db, ctx.orgId), pickItems(db, ctx.orgId)]);
  return (
    <>
      <PageHeader title="New sales order" crumbs={[{ href: "/orders", label: "Sales orders" }]} />
      <ActionForm action={createOrderAction} className="space-y-4">
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
            <Field label="Customer PO #">
              <Input name="customerPo" />
            </Field>
            <Field label="Program / kit" hint="Groups the orders of one kitting program">
              <Input name="program" placeholder="P-2026-04" />
            </Field>
            <Field label="Order date">
              <Input name="orderDate" type="date" defaultValue={today()} required />
            </Field>
            <Field label="Promised date">
              <Input name="promisedDate" type="date" defaultValue={addDays(today(), 14)} />
            </Field>
          </FormGrid>
        </Card>
        <Card title="Lines">
          <LineEditor items={itemList} mode="order" />
        </Card>
        <Card>
          <Field label="Notes">
            <Textarea name="notes" />
          </Field>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" name="confirm" defaultChecked /> Confirm immediately (skip draft)
          </label>
        </Card>
        <SubmitButton>Create order</SubmitButton>
      </ActionForm>
    </>
  );
}
