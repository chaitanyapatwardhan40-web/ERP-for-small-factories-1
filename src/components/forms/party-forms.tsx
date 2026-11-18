import type { Address, customers, vendors } from "@/lib/db/schema";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Textarea } from "@/components/ui/fields";
import { LinkButton } from "@/components/ui/button";
import { saveCustomerAction, saveVendorAction } from "@/modules/parties/actions";

function AddressFields({ prefix, value, title }: { prefix: string; value?: Address | null; title: string }) {
  return (
    <fieldset className="rounded border border-line p-3">
      <legend className="px-1 text-xs font-medium text-ink-2">{title}</legend>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Street" className="md:col-span-2">
          <Input name={`${prefix}Line1`} defaultValue={value?.line1 ?? ""} />
        </Field>
        <Field label="City">
          <Input name={`${prefix}City`} defaultValue={value?.city ?? ""} />
        </Field>
        <Field label="State">
          <Input name={`${prefix}State`} defaultValue={value?.state ?? ""} />
        </Field>
        <Field label="Postal code">
          <Input name={`${prefix}PostalCode`} defaultValue={value?.postalCode ?? ""} />
        </Field>
        <Field label="Country">
          <Input name={`${prefix}Country`} defaultValue={value?.country ?? "US"} />
        </Field>
      </div>
    </fieldset>
  );
}

export function CustomerForm({ customer }: { customer?: typeof customers.$inferSelect }) {
  return (
    <ActionForm action={saveCustomerAction} className="space-y-4">
      {customer ? <input type="hidden" name="id" value={customer.id} /> : null}
      <FormGrid cols={3}>
        <Field label="Code" hint={customer ? undefined : "Leave blank to auto-number"}>
          <Input name="code" defaultValue={customer?.code ?? ""} disabled={!!customer} />
        </Field>
        <Field label="Name" className="md:col-span-2">
          <Input name="name" required defaultValue={customer?.name ?? ""} />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" defaultValue={customer?.email ?? ""} />
        </Field>
        <Field label="Phone">
          <Input name="phone" defaultValue={customer?.phone ?? ""} />
        </Field>
        <Field label="Terms (days)">
          <Input name="termsDays" type="number" defaultValue={customer?.termsDays ?? 30} />
        </Field>
      </FormGrid>
      <div className="grid gap-4 md:grid-cols-2">
        <AddressFields prefix="bill" value={customer?.billingAddress} title="Billing address" />
        <AddressFields prefix="ship" value={customer?.shippingAddress} title="Shipping address" />
      </div>
      <Field label="Notes">
        <Textarea name="notes" defaultValue={customer?.notes ?? ""} />
      </Field>
      <div className="flex items-center gap-6 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="taxExempt" defaultChecked={customer?.taxExempt ?? false} /> Tax exempt
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" defaultChecked={customer?.active ?? true} /> Active
        </label>
      </div>
      <div className="flex gap-2">
        <SubmitButton>{customer ? "Save changes" : "Create customer"}</SubmitButton>
        <LinkButton href={customer ? `/customers/${customer.id}` : "/customers"} variant="secondary">
          Cancel
        </LinkButton>
      </div>
    </ActionForm>
  );
}

export function VendorForm({ vendor }: { vendor?: typeof vendors.$inferSelect }) {
  return (
    <ActionForm action={saveVendorAction} className="space-y-4">
      {vendor ? <input type="hidden" name="id" value={vendor.id} /> : null}
      <FormGrid cols={3}>
        <Field label="Code" hint={vendor ? undefined : "Leave blank to auto-number"}>
          <Input name="code" defaultValue={vendor?.code ?? ""} disabled={!!vendor} />
        </Field>
        <Field label="Name" className="md:col-span-2">
          <Input name="name" required defaultValue={vendor?.name ?? ""} />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" defaultValue={vendor?.email ?? ""} />
        </Field>
        <Field label="Phone">
          <Input name="phone" defaultValue={vendor?.phone ?? ""} />
        </Field>
        <Field label="Terms (days)">
          <Input name="termsDays" type="number" defaultValue={vendor?.termsDays ?? 30} />
        </Field>
        <Field label="Lead time (days)">
          <Input name="leadTimeDays" type="number" defaultValue={vendor?.leadTimeDays ?? 14} />
        </Field>
      </FormGrid>
      <AddressFields prefix="addr" value={vendor?.address} title="Address" />
      <Field label="Notes">
        <Textarea name="notes" defaultValue={vendor?.notes ?? ""} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={vendor?.active ?? true} /> Active
      </label>
      <div className="flex gap-2">
        <SubmitButton>{vendor ? "Save changes" : "Create vendor"}</SubmitButton>
        <LinkButton href={vendor ? `/vendors/${vendor.id}` : "/vendors"} variant="secondary">
          Cancel
        </LinkButton>
      </div>
    </ActionForm>
  );
}
