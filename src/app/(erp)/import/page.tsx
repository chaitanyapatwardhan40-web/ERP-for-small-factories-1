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
        title="Import data"
        description="CSV or Excel. Import vendors before items, and items before BOMs and stock counts."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <ImportWizard aiEnabled={!!process.env.ANTHROPIC_API_KEY} />
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="How it works">
            <ol className="list-inside list-decimal space-y-1 text-sm text-ink-2">
              <li>Finds the header row and skips blank lines.</li>
              <li>Detects the record type: customers, vendors, items, BOM, work centers, stock count or employees.</li>
              <li>Maps columns from the header names. You can change any mapping before loading.</li>
              <li>Rows with an existing code or SKU update that record.</li>
              <li>Stock counts post opening stock to inventory and the ledger.</li>
            </ol>
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
