import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { Card, PageHeader } from "@/components/ui/page";
import { CustomerForm } from "@/components/forms/party-forms";

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg();
  const db = await getDb();
  const [c] = await db.select().from(customers).where(and(eq(customers.id, id), eq(customers.orgId, ctx.orgId)));
  if (!c) notFound();
  return (
    <>
      <PageHeader title={`Edit ${c.name}`} crumbs={[{ href: "/customers", label: "Customers" }, { href: `/customers/${c.id}`, label: c.name }]} />
      <Card>
        <CustomerForm customer={c} />
      </Card>
    </>
  );
}
