import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { vendors } from "@/lib/db/schema";
import { Card, PageHeader } from "@/components/ui/page";
import { VendorForm } from "@/components/forms/party-forms";

export default async function EditVendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg();
  const db = await getDb();
  const [v] = await db.select().from(vendors).where(and(eq(vendors.id, id), eq(vendors.orgId, ctx.orgId)));
  if (!v) notFound();
  return (
    <>
      <PageHeader title={`Edit ${v.name}`} crumbs={[{ href: "/vendors", label: "Vendors" }, { href: `/vendors/${v.id}`, label: v.name }]} />
      <Card>
        <VendorForm vendor={v} />
      </Card>
    </>
  );
}
