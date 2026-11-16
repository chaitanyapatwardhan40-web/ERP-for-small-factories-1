import { desc, eq, and } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { Card, PageHeader } from "@/components/ui/page";
import { ImportWizard } from "@/components/forms/import-wizard";
import { fmtDateTime } from "@/lib/money";

export const metadata = { title: "Import" };

export default async function ImportPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const history = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.orgId, ctx.orgId), eq(auditLog.action, "import.run")))
    .orderBy(desc(auditLog.createdAt))
    .limit(10);
  return (
    <>
      <PageHeader
        title="Import: the implementer"
        description="Drop in the spreadsheets the shop already runs on. Customers, vendors, parts, BOMs, work centers, stock counts, people. Order: vendors → items → BOMs → stock."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <ImportWizard aiEnabled={!!process.env.ANTHROPIC_API_KEY} />
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="What the implementer does">
            <ol className="list-inside list-decimal space-y-1 text-sm text-ink-2">
              <li>Reads any sheet, finds the header row, drops blank lines.</li>
              <li>Works out whether it is customers, vendors, parts, a BOM, machines, a stock count or people.</li>
              <li>Maps columns by header meaning (Part #, P/N, Item No all mean SKU) and lets you fix any guess.</li>
              <li>Loads rows without duplicating: same SKU or code updates the record.</li>
              <li>Opening stock posts to inventory and the ledger in one go.</li>
            </ol>
            <p className="mt-3 text-xs text-ink-3">Next on the roadmap: QuickBooks export files, drawings to items, old quotes to price history, and an inbox address for RFQs and POs.</p>
          </Card>
          {history.length ? (
            <Card title="Recent imports">
              <ul className="space-y-1 text-sm">
                {history.map((h) => {
                  const d = (h.data ?? {}) as { kind?: string; created?: number; updated?: number; errors?: string[] };
                  return (
                    <li key={h.id}>
                      <span className="text-xs text-ink-3">{fmtDateTime(h.createdAt)}</span> · {d.kind}: {d.created ?? 0} created, {d.updated ?? 0} updated
                      {d.errors?.length ? <span className="text-bad"> · {d.errors.length} errors</span> : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
