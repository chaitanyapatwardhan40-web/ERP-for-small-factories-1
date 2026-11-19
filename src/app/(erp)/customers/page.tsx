import Link from "@/components/ui/link";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { Card, EmptyState, PageHeader, Badge } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { ListToolbar } from "@/components/ui/list-toolbar";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const rows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.orgId, ctx.orgId), sp.q ? or(ilike(customers.name, `%${sp.q}%`), ilike(customers.code, `%${sp.q}%`), ilike(customers.email, `%${sp.q}%`)) : undefined))
    .orderBy(asc(customers.name));
  return (
    <>
      <PageHeader title="Customers" description={`${rows.length} customers`} actions={<LinkButton href="/customers/new">New customer</LinkButton>} />
      <ListToolbar action="/customers" q={sp.q} exportKind="customers" params={sp} />
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
