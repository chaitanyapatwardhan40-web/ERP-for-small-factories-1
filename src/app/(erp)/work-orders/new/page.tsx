import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { pickItems } from "@/lib/pick";
import { Card, PageHeader } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/fields";
import { createWorkOrderAction } from "@/modules/production/actions";
import { addDays, today } from "@/lib/money";

export const metadata = { title: "New work order" };

export default async function NewWorkOrderPage({ searchParams }: { searchParams: Promise<{ itemId?: string }> }) {
  const { itemId } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const makeItems = (await pickItems(db, ctx.orgId)).filter((i) => i.type === "make");
  return (
    <>
      <PageHeader title="New work order" crumbs={[{ href: "/work-orders", label: "Work orders" }]} description="For stock or a special. Orders for customers get their work orders from the sales order." />
      <Card>
        <ActionForm action={createWorkOrderAction} className="space-y-4">
          <FormGrid cols={4}>
            <Field label="Item to make" className="md:col-span-2">
              <Select name="itemId" required defaultValue={itemId ?? ""}>
                <option value="">Select make item</option>
                {makeItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.sku} · {i.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantity">
              <Input name="qty" type="number" step="0.0001" min="0" defaultValue={1} required />
            </Field>
            <Field label="Due date">
              <Input name="dueDate" type="date" defaultValue={addDays(today(), 7)} />
            </Field>
            <Field label="Priority (1 = first)">
              <Input name="priority" type="number" min={1} max={9} defaultValue={5} />
            </Field>
          </FormGrid>
          <Field label="Notes for the floor">
            <Textarea name="notes" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="release" defaultChecked /> Release to the floor now
          </label>
          <SubmitButton>Create work order</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
