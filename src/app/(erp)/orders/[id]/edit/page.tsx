import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { uuidOr404 } from "@/lib/ids";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { salesOrderLines, salesOrders } from "@/lib/db/schema";
import { pickCustomers, pickItems } from "@/lib/pick";
import { PageHeader } from "@/components/ui/page";
import { OrderForm } from "@/components/forms/order-form";
import { priceHintsFor } from "@/modules/sales/service";

export const metadata = { title: "Edit sales order" };

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [o] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, id), eq(salesOrders.orgId, ctx.orgId)));
  if (!o) notFound();
  if (o.status !== "draft") redirect(`/orders/${o.id}`);
  const [lines, customerList, itemList, hints] = await Promise.all([
    db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, o.id)).orderBy(asc(salesOrderLines.lineNo)),
    pickCustomers(db, ctx.orgId),
    pickItems(db, ctx.orgId),
    priceHintsFor(db, ctx.orgId, o.customerId, o.orderDate),
  ]);
  return (
    <>
      <PageHeader
        title={`Edit ${o.number}`}
        crumbs={[
          { href: "/orders", label: "Sales orders" },
          { href: `/orders/${o.id}`, label: o.number },
        ]}
      />
      <OrderForm customers={customerList} items={itemList} order={o} lines={lines} priceHints={hints} />
    </>
  );
}
