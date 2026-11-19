import type { quoteLines, quotes } from "@/lib/db/schema";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/fields";
import { Card } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { LineEditor, type LineRow, type PickItem } from "@/components/forms/line-editor";
import { createQuoteAction, updateQuoteAction } from "@/modules/sales/actions";
import { addDays, today } from "@/lib/money";

export function QuoteForm({
  customers,
  items,
  quote,
  lines,
  defaults,
  defaultMarginPct,
  overheadPct,
  priceHints,
  standardTerms,
}: {
  customers: { id: string; name: string }[];
  items: PickItem[];
  quote?: typeof quotes.$inferSelect;
  lines?: (typeof quoteLines.$inferSelect)[];
  defaults?: { customerId?: string };
  defaultMarginPct: number;
  overheadPct: number;
  priceHints?: Record<string, { price: number }>;
  standardTerms?: string | null;
}) {
  const initial: Partial<LineRow>[] | undefined = lines?.length
    ? lines.map((l) => ({
        itemId: l.itemId ?? "",
        description: l.description,
        qty: String(l.qty),
        unitPrice: String(l.unitPrice),
        materialCost: Number(l.materialCost) ? String(l.materialCost) : "",
        laborCost: Number(l.laborCost) ? String(l.laborCost) : "",
        outsideCost: Number(l.outsideCost) ? String(l.outsideCost) : "",
        overheadCost: Number(l.overheadCost) ? String(l.overheadCost) : "",
        marginPct: String(l.marginPct),
        leadTimeDays: String(l.leadTimeDays),
        discountPct: Number(l.discountPct) ? String(l.discountPct) : "",
      }))
    : undefined;
  return (
    <ActionForm action={quote ? updateQuoteAction : createQuoteAction} className="space-y-4">
      {quote ? <input type="hidden" name="id" value={quote.id} /> : null}
      <Card>
        <FormGrid cols={4}>
          <Field label="Customer">
            <Select name="customerId" required defaultValue={quote?.customerId ?? defaults?.customerId ?? ""}>
              <option value="">Select customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Attention">
            <Input name="contactName" defaultValue={quote?.contactName ?? ""} placeholder="Buyer's name" />
          </Field>
          <Field label="Customer RFQ #">
            <Input name="customerRfq" defaultValue={quote?.customerRfq ?? ""} />
          </Field>
          <Field label="Quote discount %">
            <Input name="discountPct" type="number" step="0.01" min="0" max="100" defaultValue={quote?.discountPct ? String(quote.discountPct) : ""} />
          </Field>
          <Field label="Quote date">
            <Input name="quoteDate" type="date" defaultValue={quote?.quoteDate ?? today()} required />
          </Field>
          <Field label="Valid until">
            <Input name="validUntil" type="date" defaultValue={quote?.validUntil ?? addDays(today(), 30)} />
          </Field>
        </FormGrid>
      </Card>
      <Card title="Lines">
        <LineEditor items={items} mode="quote" initial={initial} defaultMarginPct={defaultMarginPct} overheadPct={overheadPct} priceHints={priceHints} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <Field label="Notes (printed on the quote)">
            <Textarea name="notes" defaultValue={quote?.notes ?? ""} />
          </Field>
        </Card>
        <Card>
          <Field label="Terms and conditions" hint="Printed under the lines">
            <Textarea name="terms" defaultValue={quote?.terms ?? standardTerms ?? ""} />
          </Field>
        </Card>
      </div>
      <div className="flex gap-2">
        <SubmitButton>{quote ? "Save changes" : "Create quote"}</SubmitButton>
        <LinkButton href={quote ? `/quotes/${quote.id}` : "/quotes"} variant="secondary">
          Cancel
        </LinkButton>
      </div>
    </ActionForm>
  );
}
