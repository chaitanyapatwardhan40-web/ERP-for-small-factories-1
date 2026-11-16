import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { customers, items, orgs, salesOrderLines, salesOrders, shipmentLines, shipments } from "@/lib/db/schema";
import { Card, DL, PageHeader, StatusBadge } from "@/components/ui/page";
import { Button, LinkButton } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/fields";
import { invoiceShipmentAction, shipShipmentAction } from "@/modules/shipping/actions";
import { fmtDateTime, fmtMoney, fmtQty, today } from "@/lib/money";

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg();
  const db = await getDb();
  const [row] = await db
    .select({ s: shipments, order: salesOrders, customer: customers })
    .from(shipments)
    .innerJoin(salesOrders, eq(salesOrders.id, shipments.orderId))
    .innerJoin(customers, eq(customers.id, shipments.customerId))
    .where(and(eq(shipments.id, id), eq(shipments.orgId, ctx.orgId)));
  if (!row) notFound();
  const { s, order, customer } = row;
  const lines = await db
    .select({ l: shipmentLines, sku: items.sku, description: salesOrderLines.description, unitPrice: salesOrderLines.unitPrice })
    .from(shipmentLines)
    .innerJoin(items, eq(items.id, shipmentLines.itemId))
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, shipmentLines.orderLineId))
    .where(eq(shipmentLines.shipmentId, s.id));
  const [org] = await db.select().from(orgs).where(eq(orgs.id, ctx.orgId));
  const value = lines.reduce((sum, l) => sum + Number(l.l.qty) * Number(l.unitPrice), 0);
  return (
    <>
      <PageHeader
        title={s.number}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={s.status} />
            <span>
              {customer.name} · order{" "}
              <Link href={`/orders/${order.id}`} className="text-brand hover:underline">
                {order.number}
              </Link>
              {s.shippedAt ? ` · shipped ${fmtDateTime(s.shippedAt)}` : ""}
            </span>
          </span>
        }
        crumbs={[{ href: "/shipments", label: "Shipments" }]}
        actions={
          <>
            <LinkButton href={`/print/packlist/${s.id}`} variant="secondary">
              Pack list
            </LinkButton>
            {s.status === "draft" ? (
              <form action={shipShipmentAction}>
                <input type="hidden" name="id" value={s.id} />
                <Button type="submit">Ship now</Button>
              </form>
            ) : null}
            {s.invoiceId ? <LinkButton href={`/invoices/${s.invoiceId}`}>Open invoice</LinkButton> : null}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Contents" padded={false} className="lg:col-span-2">
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th>Description</th>
                <th className="num">Qty</th>
                <th>Lot</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.l.id}>
                  <td>{l.sku}</td>
                  <td>{l.description}</td>
                  <td className="num">{fmtQty(l.l.qty)}</td>
                  <td>{l.l.lotNumber}</td>
                  <td className="num">{fmtMoney(Number(l.l.qty) * Number(l.unitPrice))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="text-right font-medium">
                  Total
                </td>
                <td className="num font-semibold">{fmtMoney(value)}</td>
              </tr>
            </tfoot>
          </table>
        </Card>
        <div className="space-y-4">
          <Card title="Details">
            <DL rows={[["Carrier", s.carrier], ["Tracking", s.tracking], ["Notes", s.notes]]} />
          </Card>
          {s.status === "shipped" && !s.invoiceId ? (
            <Card title="Invoice this shipment">
              <ActionForm action={invoiceShipmentAction} className="space-y-2">
                <input type="hidden" name="shipmentId" value={s.id} />
                <Input name="issueDate" type="date" defaultValue={today()} />
                <Input name="taxRatePct" type="number" step="0.01" defaultValue={customer.taxExempt ? 0 : org?.settings.defaultTaxRatePct ?? 0} placeholder="Tax %" />
                <SubmitButton className="w-full">Create invoice</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
