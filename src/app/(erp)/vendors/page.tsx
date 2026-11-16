import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { vendors } from "@/lib/db/schema";
import { Card, EmptyState, PageHeader, Badge } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";

export const metadata = { title: "Vendors" };

export default async function VendorsPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const rows = await db.select().from(vendors).where(eq(vendors.orgId, ctx.orgId)).orderBy(asc(vendors.name));
  return (
    <>
      <PageHeader title="Vendors" description={`${rows.length} vendors`} actions={<LinkButton href="/vendors/new">New vendor</LinkButton>} />
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
                <th className="num">Lead time</th>
                <th className="num">Rating</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td className="font-mono text-xs">{v.code}</td>
                  <td>
                    <Link href={`/vendors/${v.id}`} className="font-medium text-brand hover:underline">
                      {v.name}
                    </Link>
                  </td>
                  <td>{v.email}</td>
                  <td>{v.phone}</td>
                  <td>Net {v.termsDays}</td>
                  <td className="num">{v.leadTimeDays} d</td>
                  <td className="num">{v.rating === null ? "—" : `${Number(v.rating).toFixed(0)}%`}</td>
                  <td>{v.active ? null : <Badge tone="bad">inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState title="No vendors yet" action={<LinkButton href="/vendors/new">New vendor</LinkButton>} />
      )}
    </>
  );
}
