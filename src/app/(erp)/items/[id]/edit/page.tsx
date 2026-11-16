import { notFound } from "next/navigation";
import { uuidOr404 } from "@/lib/ids";
import { and, asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { items, units, vendors } from "@/lib/db/schema";
import { Card, PageHeader } from "@/components/ui/page";
import { ItemForm } from "@/components/forms/item-form";

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [item] = await db.select().from(items).where(and(eq(items.id, id), eq(items.orgId, ctx.orgId)));
  if (!item) notFound();
  const [vendorList, unitRows] = await Promise.all([
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.orgId, ctx.orgId)).orderBy(asc(vendors.name)),
    db.select().from(units).where(eq(units.orgId, ctx.orgId)),
  ]);
  return (
    <>
      <PageHeader title={`Edit ${item.sku}`} crumbs={[{ href: "/items", label: "Items" }, { href: `/items/${item.id}`, label: item.sku }]} />
      <Card>
        <ItemForm item={item} vendorList={vendorList} units={unitRows.map((u) => u.code)} />
      </Card>
    </>
  );
}
