import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { pickItems, pickLocations } from "@/lib/pick";
import { Card, PageHeader } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select } from "@/components/ui/fields";
import { adjustStockAction, transferStockAction } from "@/modules/inventory/actions";

export const metadata = { title: "Count, adjust, move" };

export default async function AdjustPage({ searchParams }: { searchParams: Promise<{ itemId?: string }> }) {
  const { itemId } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const [itemList, locs] = await Promise.all([pickItems(db, ctx.orgId), pickLocations(db, ctx.orgId)]);
  const ItemSelect = ({ name }: { name: string }) => (
    <Select name={name} required defaultValue={itemId ?? ""}>
      <option value="">Select item</option>
      {itemList.map((i) => (
        <option key={i.id} value={i.id}>
          {i.sku} · {i.name}
        </option>
      ))}
    </Select>
  );
  const LocSelect = ({ name, def }: { name: string; def?: string }) => (
    <Select name={name} required defaultValue={def ?? locs[0]?.id ?? ""}>
      {locs.map((l) => (
        <option key={l.id} value={l.id}>
          {l.code} · {l.name}
        </option>
      ))}
    </Select>
  );
  return (
    <>
      <PageHeader title="Count, adjust, move" crumbs={[{ href: "/inventory", label: "Inventory" }]} description="Counts post the difference to the book. Adjustments and scrap hit the ledger; moves between locations do not." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Count or adjust">
          <ActionForm action={adjustStockAction} className="space-y-3">
            <FormGrid cols={2}>
              <Field label="Item" className="md:col-span-2">
                <ItemSelect name="itemId" />
              </Field>
              <Field label="Location">
                <LocSelect name="locationId" />
              </Field>
              <Field label="Mode">
                <Select name="mode" defaultValue="count">
                  <option value="count">Count: set what is physically there</option>
                  <option value="adjust">Adjust: add (+) or remove (−) this quantity</option>
                  <option value="receive">Receive without a PO (opening stock)</option>
                  <option value="scrap">Scrap this quantity</option>
                </Select>
              </Field>
              <Field label="Quantity">
                <Input name="qty" type="number" step="0.0001" required />
              </Field>
              <Field label="Unit cost" hint="Only used when stock increases">
                <Input name="unitCost" type="number" step="0.0001" />
              </Field>
              <Field label="Lot">
                <Input name="lotNumber" />
              </Field>
              <Field label="Memo">
                <Input name="memo" />
              </Field>
            </FormGrid>
            <SubmitButton>Post</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Move between locations">
          <ActionForm action={transferStockAction} className="space-y-3">
            <FormGrid cols={2}>
              <Field label="Item" className="md:col-span-2">
                <ItemSelect name="itemId" />
              </Field>
              <Field label="From">
                <LocSelect name="fromLocationId" />
              </Field>
              <Field label="To">
                <LocSelect name="toLocationId" def={locs[1]?.id} />
              </Field>
              <Field label="Quantity">
                <Input name="qty" type="number" step="0.0001" required />
              </Field>
              <Field label="Lot">
                <Input name="lotNumber" />
              </Field>
            </FormGrid>
            <SubmitButton variant="secondary">Move</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
