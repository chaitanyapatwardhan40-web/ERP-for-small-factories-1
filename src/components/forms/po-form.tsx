import type { Address, purchaseOrders, purchaseOrderLines } from "@/lib/db/schema";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/fields";
import { Card } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { LineEditor, type LineRow, type PickItem } from "@/components/forms/line-editor";
import { AddressFields } from "@/components/forms/address-fields";
import { createPoAction, updatePoAction } from "@/modules/purchasing/actions";
import { today } from "@/lib/money";

type Vendor = { id: string; name: string; leadTimeDays: number; termsDays: number; shipVia?: string | null };

export function PoForm({
  vendors,
  items,
  po,
  lines,
  defaults,
  priceHints,
  shipTo,
}: {
  vendors: Vendor[];
  items: PickItem[];
  po?: typeof purchaseOrders.$inferSelect;
  lines?: (typeof purchaseOrderLines.$inferSelect)[];
  defaults?: { vendorId?: string; workOrderId?: string; initialLines?: Partial<LineRow>[] };
  priceHints?: Record<string, { price: number; partNo?: string | null }>;
  shipTo?: Address | null;
}) {
  const initial: Partial<LineRow>[] | undefined = lines?.length
    ? lines.map((l) => ({
        itemId: l.itemId ?? "",
        description: l.description,
        qty: String(l.qty),
        unitPrice: String(l.unitCost),
        vendorPartNo: l.vendorPartNo ?? "",
        expectedDate: l.expectedDate ?? "",
      }))
    : defaults?.initialLines;
  const vendorId = po?.vendorId ?? defaults?.vendorId ?? "";
  return (
    <ActionForm action={po ? updatePoAction : createPoAction} className="space-y-4">
      {po ? <input type="hidden" name="id" value={po.id} /> : null}
      {defaults?.workOrderId ? <input type="hidden" name="workOrderId" value={defaults.workOrderId} /> : null}
      <Card>
        <FormGrid cols={4}>
          <Field label="Vendor">
            <Select name="vendorId" required defaultValue={vendorId}>
              <option value="">Select vendor</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.leadTimeDays} d)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Order date">
            <Input name="orderDate" type="date" defaultValue={po?.orderDate ?? today()} required />
          </Field>
          <Field label="Expected date" hint="Blank = vendor lead time">
            <Input name="expectedDate" type="date" defaultValue={po?.expectedDate ?? ""} />
          </Field>
          <Field label="Vendor reference">
            <Input name="vendorRef" defaultValue={po?.vendorRef ?? ""} placeholder="Quote or order #" />
          </Field>
          <Field label="Terms (days)" hint="Blank = vendor terms">
            <Input name="termsDays" type="number" min="0" defaultValue={po?.termsDays ?? ""} />
          </Field>
          <Field label="Ship via">
            <Input name="shipVia" defaultValue={po?.shipVia ?? ""} placeholder="UPS Ground, vendor truck…" />
          </Field>
          <Field label="Freight (expected)">
            <Input name="freight" type="number" step="0.01" min="0" defaultValue={po?.freight ? String(po.freight) : ""} />
          </Field>
          <Field label="Tax (expected)">
            <Input name="tax" type="number" step="0.01" min="0" defaultValue={po?.tax ? String(po.tax) : ""} />
          </Field>
        </FormGrid>
      </Card>
      <Card title="Lines">
        <LineEditor items={items} mode="po" initial={initial} priceHints={priceHints} />
        <p className="mt-2 text-xs text-ink-3">Leave the unit cost blank to use the vendor&apos;s last price. Pick &ldquo;non-stock&rdquo; for freight, tooling or outside work; those lines are billed, not received.</p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <AddressFields prefix="shipTo" value={po?.shipTo ?? shipTo} title="Ship to" />
        </Card>
        <Card>
          <Field label="Notes to vendor" hint="Printed on the PO">
            <Textarea name="notes" defaultValue={po?.notes ?? ""} />
          </Field>
          <Field label="Internal notes" className="mt-3">
            <Textarea name="internalNotes" defaultValue={po?.internalNotes ?? ""} />
          </Field>
          {!po ? (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" name="send" defaultChecked /> Mark as sent
            </label>
          ) : null}
        </Card>
      </div>
      <div className="flex gap-2">
        <SubmitButton>{po ? "Save changes" : "Create PO"}</SubmitButton>
        <LinkButton href={po ? `/purchasing/${po.id}` : "/purchasing"} variant="secondary">
          Cancel
        </LinkButton>
      </div>
    </ActionForm>
  );
}
