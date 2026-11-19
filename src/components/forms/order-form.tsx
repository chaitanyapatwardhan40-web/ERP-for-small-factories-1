import type { Address, salesOrderLines, salesOrders } from "@/lib/db/schema";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/fields";
import { Card } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { LineEditor, type LineRow, type PickItem, type PriceHint } from "@/components/forms/line-editor";
import { AddressFields } from "@/components/forms/address-fields";
import { createOrderAction, updateOrderAction } from "@/modules/sales/actions";
import { addDays, today } from "@/lib/money";

type Customer = { id: string; name: string };

export function OrderForm({
  customers,
  items,
  order,
  lines,
  defaults,
  priceHints,
  shipTo,
  addresses,
}: {
  customers: Customer[];
  items: PickItem[];
  order?: typeof salesOrders.$inferSelect;
  lines?: (typeof salesOrderLines.$inferSelect)[];
  defaults?: { customerId?: string };
  priceHints?: Record<string, PriceHint>;
  shipTo?: Address | null;
  addresses?: { label: string; address: Address }[];
}) {
  const initial: Partial<LineRow>[] | undefined = lines?.length
    ? lines.map((l) => ({ itemId: l.itemId, description: l.description, qty: String(l.qty), unitPrice: String(l.unitPrice), discountPct: Number(l.discountPct) ? String(l.discountPct) : "", promisedDate: l.promisedDate ?? "" }))
    : undefined;
  return (
    <ActionForm action={order ? updateOrderAction : createOrderAction} className="space-y-4">
      {order ? <input type="hidden" name="id" value={order.id} /> : null}
      <Card>
        <FormGrid cols={4}>
          <Field label="Customer">
            <Select name="customerId" required defaultValue={order?.customerId ?? defaults?.customerId ?? ""}>
              <option value="">Select customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Customer PO #">
            <Input name="customerPo" defaultValue={order?.customerPo ?? ""} />
          </Field>
          <Field label="Program / kit" hint="Groups the orders of one kitting program">
            <Input name="program" defaultValue={order?.program ?? ""} placeholder="P-2026-04" />
          </Field>
          <Field label="Sales rep">
            <Input name="salesRep" defaultValue={order?.salesRep ?? ""} placeholder="Blank = customer's rep" />
          </Field>
          <Field label="Order date">
            <Input name="orderDate" type="date" defaultValue={order?.orderDate ?? today()} required />
          </Field>
          <Field label="Requested date" hint="What the customer asked for">
            <Input name="requestedDate" type="date" defaultValue={order?.requestedDate ?? ""} />
          </Field>
          <Field label="Promised date" hint="What we commit to">
            <Input name="promisedDate" type="date" defaultValue={order?.promisedDate ?? addDays(today(), 14)} />
          </Field>
          <Field label="Terms (days)" hint="Blank = customer terms">
            <Input name="termsDays" type="number" min="0" defaultValue={order?.termsDays ?? ""} />
          </Field>
          <Field label="Ship via">
            <Input name="shipVia" defaultValue={order?.shipVia ?? ""} placeholder="Blank = customer default" />
          </Field>
          <Field label="Freight to invoice">
            <Input name="freight" type="number" step="0.01" min="0" defaultValue={order?.freight ? String(order.freight) : ""} />
          </Field>
          <Field label="Order discount %" hint="Applied on the invoice after line discounts">
            <Input name="discountPct" type="number" step="0.01" min="0" max="100" defaultValue={order?.discountPct ? String(order.discountPct) : ""} />
          </Field>
        </FormGrid>
      </Card>
      <Card title="Lines">
        <LineEditor items={items} mode="order" initial={initial} priceHints={priceHints} />
        <p className="mt-2 text-xs text-ink-3">Leave the unit price blank to use the customer&apos;s price list, then the item&apos;s list price. Blank discount uses the customer&apos;s standard discount.</p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <AddressFields prefix="shipTo" value={order?.shipTo ?? shipTo} title="Ship to" />
          {addresses?.length ? (
            <p className="mt-2 text-xs text-ink-3">Other addresses on file: {addresses.map((a) => `${a.label} (${[a.address.city, a.address.state].filter(Boolean).join(", ")})`).join("; ")}</p>
          ) : null}
        </Card>
        <Card>
          <Field label="Notes" hint="Printed on the acknowledgement and pack list">
            <Textarea name="notes" defaultValue={order?.notes ?? ""} />
          </Field>
          <Field label="Internal notes" className="mt-3">
            <Textarea name="internalNotes" defaultValue={order?.internalNotes ?? ""} />
          </Field>
          {!order ? (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" name="confirm" defaultChecked /> Confirm immediately (skip draft)
            </label>
          ) : null}
        </Card>
      </div>
      <div className="flex gap-2">
        <SubmitButton>{order ? "Save changes" : "Create order"}</SubmitButton>
        <LinkButton href={order ? `/orders/${order.id}` : "/orders"} variant="secondary">
          Cancel
        </LinkButton>
      </div>
    </ActionForm>
  );
}
