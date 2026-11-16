import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { attachments, users } from "@/lib/db/schema";
import { Card, EmptyState, PageHeader, Badge } from "@/components/ui/page";
import { fmtDateTime } from "@/lib/money";

export const metadata = { title: "Documents" };

const entityHref = (type: string, id: string) =>
  type === "item" ? `/items/${id}` : type === "work-order" ? `/work-orders/${id}` : type === "customer" ? `/customers/${id}` : type === "vendor" ? `/vendors/${id}` : "#";

export default async function DocumentsPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const rows = await db.select({ a: attachments, by: users.name }).from(attachments).leftJoin(users, eq(users.id, attachments.uploadedBy)).where(eq(attachments.orgId, ctx.orgId)).orderBy(desc(attachments.createdAt)).limit(300);
  return (
    <>
      <PageHeader title="Documents and drawings" description="Every file attached to an item, job, customer or vendor, with its revision. Upload from the record it belongs to." />
      {rows.length ? (
        <Card padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>File</th>
                <th>Kind</th>
                <th>Rev</th>
                <th>Attached to</th>
                <th>Uploaded</th>
                <th>By</th>
                <th className="num">Size</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, by }) => (
                <tr key={a.id}>
                  <td>
                    <a href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" className={`font-medium hover:underline ${a.current ? "text-brand" : "text-ink-3 line-through"}`}>
                      {a.filename}
                    </a>
                    {a.note ? <div className="text-xs text-ink-3">{a.note}</div> : null}
                  </td>
                  <td>
                    <Badge>{a.kind}</Badge>
                  </td>
                  <td>{a.revision}</td>
                  <td>
                    <Link href={entityHref(a.entityType, a.entityId)} className="text-brand hover:underline">
                      {a.entityType.replace("-", " ")}
                    </Link>
                  </td>
                  <td>{fmtDateTime(a.createdAt)}</td>
                  <td>{by}</td>
                  <td className="num">{(a.size / 1024).toFixed(0)} KB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState title="No documents yet" hint="Open an item or work order and upload a drawing, spec or cert." />
      )}
    </>
  );
}
