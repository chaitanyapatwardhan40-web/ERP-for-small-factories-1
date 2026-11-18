import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { pickItems, pickVendors } from "@/lib/pick";
import { Card, PageHeader } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/fields";
import { LineEditor } from "@/components/forms/line-editor";
import { createPoAction } from "@/modules/purchasing/actions";
import { today } from "@/lib/money";

export const metadata = { title: "New purchase order" };

export default async function NewPoPage({ searchParams }: { searchParams: Promise<{ vendorId?: string; itemId?: string; workOrderId?: string }> }) {
  const { vendorId, itemId, workOrderId } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const [vendorList, itemList] = await Promise.all([pickVendors(db, ctx.orgId), pickItems(db, ctx.orgId)]);
  const initial = itemId ? [{ itemId, description: itemList.find((i) => i.id === itemId)?.name ?? "", unitPrice: String(itemList.find((i) => i.id === itemId)?.lastCost ?? "") }] : undefined;
  return (
    <>
      <PageHeader title="New purchase order" crumbs={[{ href: "/purchasing", label: "Purchase orders" }]} description={workOrderId ? "Outside processing" : undefined} />
      <ActionForm action={createPoAction} className="space-y-4">
        {workOrderId ? <input type="hidden" name="workOrderId" value={workOrderId} /> : null}
        <Card>
          <FormGrid cols={4}>
            <Field label="Vendor">
              <Select name="vendorId" required defaultValue={vendorId ?? ""}>
                <option value="">Select vendor</option>
                {vendorList.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.leadTimeDays} d)
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Order date">
              <Input name="orderDate" type="date" defaultValue={today()} required />
            </Field>
            <Field label="Expected date" hint="Blank = vendor lead time">
              <Input name="expectedDate" type="date" />
            </Field>
          </FormGrid>
        </Card>
        <Card title="Lines">
          <LineEditor items={itemList} mode="po" initial={initial} />
        </Card>
        <Card>
          <Field label="Notes to vendor">
            <Textarea name="notes" />
          </Field>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" name="send" defaultChecked /> Mark as sent
          </label>
        </Card>
        <SubmitButton>Create PO</SubmitButton>
      </ActionForm>
    </>
  );
}
