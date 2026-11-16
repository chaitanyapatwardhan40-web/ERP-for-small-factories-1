import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { customers, items, salesOrderLines, salesOrders } from "@/lib/db/schema";
import { pickLocations } from "@/lib/pick";
import { onHand } from "@/modules/inventory/service";
import { Card, PageHeader } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select } from "@/components/ui/fields";
import { createShipmentAction } from "@/modules/shipping/actions";
import { fmtQty } from "@/lib/money";

export const metadata = { title: "Pack a shipment" };

export default async function NewShipmentPage({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  const { orderId } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  if (!orderId) notFound();
  const [row] = await db.select({ o: salesOrders, customerName: customers.name }).from(salesOrders).innerJoin(customers, eq(customers.id, salesOrders.customerId)).where(and(eq(salesOrders.id, orderId), eq(salesOrders.orgId, ctx.orgId)));
  if (!row) notFound();
  const lines = await db.select({ l: salesOrderLines, sku: items.sku }).from(salesOrderLines).innerJoin(items, eq(items.id, salesOrderLines.itemId)).where(eq(salesOrderLines.orderId, orderId)).orderBy(asc(salesOrderLines.lineNo));
  const locs = (await pickLocations(db, ctx.orgId)).filter((l) => l.type !== "wip");
  const stock = await Promise.all(lines.map((l) => onHand(db, ctx.orgId, l.l.itemId)));
  const open = lines.map((l, i) => ({ ...l, open: Number(l.l.qty) - Number(l.l.qtyShipped), stock: stock[i] })).filter((l) => l.open > 0);
  return (
    <>
      <PageHeader title={`Pack ${row.o.number}`} description={row.customerName} crumbs={[{ href: "/orders", label: "Sales orders" }, { href: `/orders/${orderId}`, label: row.o.number }]} />
      <ActionForm action={createShipmentAction} className="space-y-4">
        <input type="hidden" name="orderId" value={orderId} />
        <Card title="Lines" padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Open</th>
                <th className="num">In stock</th>
                <th className="num w-32">Ship now</th>
                <th className="w-40">Lot</th>
              </tr>
            </thead>
            <tbody>
              {open.map((l, i) => (
                <tr key={l.l.id}>
                  <td>
                    <input type="hidden" name={`lines[${i}][orderLineId]`} value={l.l.id} />
                    {l.sku} <span className="text-ink-3">{l.l.description}</span>
                  </td>
                  <td className="num">{fmtQty(l.open)}</td>
                  <td className={`num ${l.stock < l.open ? "text-warn" : ""}`}>{fmtQty(l.stock)}</td>
                  <td>
                    <Input name={`lines[${i}][qty]`} type="number" step="0.0001" min="0" defaultValue={Math.min(l.open, Math.max(0, l.stock))} className="text-right" />
                  </td>
                  <td>
                    <Input name={`lines[${i}][lotNumber]`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          <FormGrid cols={4}>
            <Field label="From location">
              <Select name="locationId" required defaultValue={locs[0]?.id ?? ""}>
                {locs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} · {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Carrier">
              <Input name="carrier" placeholder="UPS, FedEx, customer pickup" />
            </Field>
            <Field label="Tracking #">
              <Input name="tracking" />
            </Field>
            <Field label="Notes">
              <Input name="notes" />
            </Field>
          </FormGrid>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" name="ship" defaultChecked /> Ship now (otherwise save as a packed draft)
          </label>
        </Card>
        <SubmitButton>Create shipment</SubmitButton>
      </ActionForm>
    </>
  );
}
