import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { customerAddresses, customers } from "@/lib/db/schema";
import { pickCustomers, pickItems } from "@/lib/pick";
import { PageHeader } from "@/components/ui/page";
import { OrderForm } from "@/components/forms/order-form";
import { priceHintsFor } from "@/modules/sales/service";
import { today } from "@/lib/money";

export const metadata = { title: "New sales order" };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const { customerId } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const [customerList, itemList, hints, cust, addrs] = await Promise.all([
    pickCustomers(db, ctx.orgId),
    pickItems(db, ctx.orgId),
    priceHintsFor(db, ctx.orgId, customerId ?? null, today()),
    customerId ? db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.orgId, ctx.orgId))).then((r) => r[0]) : Promise.resolve(undefined),
    customerId ? db.select().from(customerAddresses).where(eq(customerAddresses.customerId, customerId)) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title="New sales order" crumbs={[{ href: "/orders", label: "Sales orders" }]} description={cust ? `${cust.name} · net ${cust.termsDays}${cust.creditHold ? " · on credit hold" : ""}` : undefined} />
      <OrderForm customers={customerList} items={itemList} defaults={{ customerId }} priceHints={hints} shipTo={cust?.shippingAddress} addresses={addrs.map((a) => ({ label: a.label, address: a.address }))} />
    </>
  );
}
