import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { Card, EmptyState, PageHeader, Badge } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";

export const metadata = { title: "Customers" };

export default async function CustomersPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const rows = await db.select().from(customers).where(eq(customers.orgId, ctx.orgId)).orderBy(asc(customers.name));
  return (
    <>
      <PageHeader title="Customers" description={`${rows.length} customers`} actions={<LinkButton href="/customers/new">New customer</LinkButton>} />
      {rows.length ? (
        <Card padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Terms</th>
                <th>City</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs">{c.code}</td>
                  <td>
                    <Link href={`/customers/${c.id}`} className="font-medium text-brand hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td>{c.email}</td>
                  <td>{c.phone}</td>
                  <td>Net {c.termsDays}</td>
                  <td>{c.billingAddress?.city}</td>
                  <td>{c.active ? null : <Badge tone="bad">inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState title="No customers yet" hint="Add one by hand or import a spreadsheet." action={<LinkButton href="/customers/new">New customer</LinkButton>} />
      )}
    </>
  );
}
