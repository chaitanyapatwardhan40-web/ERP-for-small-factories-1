import { asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { units, vendors } from "@/lib/db/schema";
import { Card, PageHeader } from "@/components/ui/page";
import { ItemForm } from "@/components/forms/item-form";

export const metadata = { title: "New item" };

export default async function NewItemPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const [vendorList, unitRows] = await Promise.all([
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.orgId, ctx.orgId)).orderBy(asc(vendors.name)),
    db.select().from(units).where(eq(units.orgId, ctx.orgId)),
  ]);
  return (
    <>
      <PageHeader title="New item" crumbs={[{ href: "/items", label: "Items" }]} />
      <Card>
        <ItemForm vendorList={vendorList} units={unitRows.map((u) => u.code)} />
      </Card>
    </>
  );
}
