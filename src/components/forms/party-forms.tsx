import type { customers, vendors } from "@/lib/db/schema";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/fields";
import { LinkButton } from "@/components/ui/button";
import { saveCustomerAction, saveVendorAction } from "@/modules/parties/actions";
import { AddressFields } from "./address-fields";

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
        <Field label="Website">
          <Input name="website" defaultValue={customer?.website ?? ""} />
        </Field>
        <Field label="Industry">
          <Input name="industry" defaultValue={customer?.industry ?? ""} placeholder="Medical devices, robotics…" />
        </Field>
        <Field label="Sales rep">
          <Input name="salesRep" defaultValue={customer?.salesRep ?? ""} />
        </Field>
        <Field label="Ship via">
          <Input name="shipVia" defaultValue={customer?.shipVia ?? ""} placeholder="UPS Ground, customer pickup…" />
        </Field>
        <Field label="Terms (days)">
          <Input name="termsDays" type="number" defaultValue={customer?.termsDays ?? 30} />
        </Field>
        <Field label="Credit limit" hint="0 = no limit">
          <Input name="creditLimit" type="number" step="0.01" min="0" defaultValue={customer?.creditLimit ?? 0} />
        </Field>
        <Field label="Standard discount %">
          <Input name="discountPct" type="number" step="0.01" min="0" max="100" defaultValue={customer?.discountPct ?? 0} />
        </Field>
        <Field label="Tax exemption certificate #">
          <Input name="taxCertNo" defaultValue={customer?.taxCertNo ?? ""} />
        </Field>
      </FormGrid>
      <div className="grid gap-4 md:grid-cols-2">
        <AddressFields prefix="bill" value={customer?.billingAddress} title="Billing address" />
        <AddressFields prefix="ship" value={customer?.shippingAddress} title="Default shipping address" />
      </div>
      <Field label="Notes">
        <Textarea name="notes" defaultValue={customer?.notes ?? ""} />
      </Field>
      <div className="flex flex-wrap items-center gap-6 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="taxExempt" defaultChecked={customer?.taxExempt ?? false} /> Tax exempt
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="creditHold" defaultChecked={customer?.creditHold ?? false} /> Credit hold (orders cannot be confirmed)
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
        <Field label="Email" hint="Where purchase orders go">
          <Input name="email" type="email" defaultValue={vendor?.email ?? ""} />
        </Field>
        <Field label="Phone">
          <Input name="phone" defaultValue={vendor?.phone ?? ""} />
        </Field>
        <Field label="Website">
          <Input name="website" defaultValue={vendor?.website ?? ""} />
        </Field>
        <Field label="Terms (days)">
          <Input name="termsDays" type="number" defaultValue={vendor?.termsDays ?? 30} />
        </Field>
        <Field label="Lead time (days)">
          <Input name="leadTimeDays" type="number" defaultValue={vendor?.leadTimeDays ?? 14} />
        </Field>
        <Field label="Minimum order">
          <Input name="minOrder" type="number" step="0.01" min="0" defaultValue={vendor?.minOrder ?? 0} />
        </Field>
        <Field label="Our account # with them">
          <Input name="accountNo" defaultValue={vendor?.accountNo ?? ""} />
        </Field>
        <Field label="Payment method">
          <Select name="paymentMethod" defaultValue={vendor?.paymentMethod ?? "check"}>
            <option value="check">Check</option>
            <option value="ach">ACH</option>
            <option value="card">Card</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Ship via">
          <Input name="shipVia" defaultValue={vendor?.shipVia ?? ""} />
        </Field>
        <Field label="Tax ID (for 1099s)">
          <Input name="taxId" defaultValue={vendor?.taxId ?? ""} />
        </Field>
      </FormGrid>
      <AddressFields prefix="addr" value={vendor?.address} title="Address" />
      <Field label="Notes">
        <Textarea name="notes" defaultValue={vendor?.notes ?? ""} />
      </Field>
      <div className="flex flex-wrap items-center gap-6 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="is1099" defaultChecked={vendor?.is1099 ?? false} /> 1099 vendor
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" defaultChecked={vendor?.active ?? true} /> Active
        </label>
      </div>
      <div className="flex gap-2">
        <SubmitButton>{vendor ? "Save changes" : "Create vendor"}</SubmitButton>
        <LinkButton href={vendor ? `/vendors/${vendor.id}` : "/vendors"} variant="secondary">
          Cancel
        </LinkButton>
      </div>
    </ActionForm>
  );
}
