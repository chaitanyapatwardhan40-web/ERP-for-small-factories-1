import type { Address } from "@/lib/db/schema";
import { Field, Input } from "@/components/ui/fields";

export function AddressFields({ prefix, value, title }: { prefix: string; value?: Address | null; title: string }) {
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
