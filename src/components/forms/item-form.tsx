import type { items, vendors } from "@/lib/db/schema";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/fields";
import { LinkButton } from "@/components/ui/button";
import { saveItemAction } from "@/modules/items/actions";

export function ItemForm({ item, vendorList, units }: { item?: typeof items.$inferSelect; vendorList: Pick<typeof vendors.$inferSelect, "id" | "name">[]; units: string[] }) {
  return (
    <ActionForm action={saveItemAction} className="space-y-4">
      {item ? <input type="hidden" name="id" value={item.id} /> : null}
      <FormGrid cols={3}>
        <Field label="SKU / part number">
          <Input name="sku" required defaultValue={item?.sku ?? ""} />
        </Field>
        <Field label="Name" className="md:col-span-2">
          <Input name="name" required defaultValue={item?.name ?? ""} />
        </Field>
        <Field label="Type" hint="Make: built here. Buy: purchased. Phantom: a grouping that explodes into its parts. Service: labour or outside work.">
          <Select name="type" defaultValue={item?.type ?? "buy"}>
            <option value="make">Make</option>
            <option value="buy">Buy</option>
            <option value="phantom">Phantom</option>
            <option value="service">Service</option>
          </Select>
        </Field>
        <Field label="Unit of measure">
          <Select name="uom" defaultValue={item?.uom ?? "ea"}>
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={item?.status ?? "active"}>
            <option value="active">Active</option>
            <option value="obsolete">Obsolete</option>
          </Select>
        </Field>
        <Field label="Standard cost" hint="Buy items: purchase cost. Make items: rolled up from BOM and routing.">
          <Input name="standardCost" type="number" step="0.0001" defaultValue={item?.standardCost ?? 0} />
        </Field>
        <Field label="Sales price">
          <Input name="salesPrice" type="number" step="0.01" defaultValue={item?.salesPrice ?? 0} />
        </Field>
        <Field label="Lead time (days)">
          <Input name="leadTimeDays" type="number" defaultValue={item?.leadTimeDays ?? 0} />
        </Field>
        <Field label="Reorder point">
          <Input name="reorderPoint" type="number" step="0.0001" defaultValue={item?.reorderPoint ?? 0} />
        </Field>
        <Field label="Reorder quantity">
          <Input name="reorderQty" type="number" step="0.0001" defaultValue={item?.reorderQty ?? 0} />
        </Field>
        <Field label="Preferred vendor">
          <Select name="preferredVendorId" defaultValue={item?.preferredVendorId ?? ""}>
            <option value="">—</option>
            {vendorList.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Revision">
          <Input name="revision" defaultValue={item?.revision ?? "A"} />
        </Field>
        <Field label="Drawing number">
          <Input name="drawingNumber" defaultValue={item?.drawingNumber ?? ""} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" name="trackLots" defaultChecked={item?.trackLots ?? false} /> Track lots
        </label>
      </FormGrid>
      <Field label="Description">
        <Textarea name="description" defaultValue={item?.description ?? ""} />
      </Field>
      <div className="flex gap-2">
        <SubmitButton>{item ? "Save changes" : "Create item"}</SubmitButton>
        <LinkButton href={item ? `/items/${item.id}` : "/items"} variant="secondary">
          Cancel
        </LinkButton>
      </div>
    </ActionForm>
  );
}
