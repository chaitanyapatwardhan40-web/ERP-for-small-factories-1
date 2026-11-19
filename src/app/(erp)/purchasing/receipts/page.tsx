import Link from "@/components/ui/link";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { listReceipts } from "@/modules/purchasing/service";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui/page";
import { fmtDateTime, fmtMoney, fmtQty } from "@/lib/money";

export const metadata = { title: "Receiving log" };

export default async function ReceiptsPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const rows = await listReceipts(db, ctx.orgId);
  return (
    <>
      <PageHeader title="Receiving log" crumbs={[{ href: "/purchasing", label: "Purchase orders" }]} description={`Last ${rows.length} receipt lines`} />
      {rows.length ? (
        <Card padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Received</th>
                <th>PO</th>
                <th>Vendor</th>
                <th>Item</th>
                <th className="num">Qty</th>
                <th className="num">Unit cost</th>
                <th>Lot</th>
                <th>Slip</th>
                <th>Inspection</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.receiptId}-${i}`}>
                  <td className="font-mono text-xs">{r.number}</td>
                  <td>{fmtDateTime(r.receivedAt)}</td>
                  <td>
                    <Link href={`/purchasing/${r.poId}`} className="text-brand hover:underline">
                      {r.poNumber}
                    </Link>
                  </td>
                  <td>{r.vendorName}</td>
                  <td>
                    {r.sku} <span className="text-ink-3">{r.itemName}</span>
                  </td>
                  <td className="num">{fmtQty(r.qty)}</td>
                  <td className="num">{fmtMoney(r.unitCost)}</td>
                  <td>{r.lotNumber}</td>
                  <td>{r.packingSlip}</td>
                  <td>{r.inspectionStatus === "not_required" ? <span className="text-ink-3">—</span> : <StatusBadge status={r.inspectionStatus} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState title="Nothing received yet" />
      )}
    </>
  );
}
