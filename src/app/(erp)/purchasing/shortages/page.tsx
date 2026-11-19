import Link from "@/components/ui/link";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { shortageReport } from "@/modules/purchasing/service";
import { pickVendors } from "@/lib/pick";
import { Card, EmptyState, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { createPosFromShortagesAction } from "@/modules/purchasing/actions";
import { fmtMoney, fmtQty } from "@/lib/money";

export const metadata = { title: "What to buy" };

export default async function ShortagesPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const [rows, vendorList] = await Promise.all([shortageReport(db, ctx.orgId), pickVendors(db, ctx.orgId)]);
  const vendorName = (id: string | null) => vendorList.find((v) => v.id === id)?.name;
  return (
    <>
      <PageHeader title="What to buy" description="Open demand less stock on hand and open purchase orders." crumbs={[{ href: "/purchasing", label: "Purchase orders" }]} />
      {rows.length ? (
        <form action={createPosFromShortagesAction}>
          <Card padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th></th>
                  <th>Item</th>
                  <th className="num">On hand</th>
                  <th className="num">Demand</th>
                  <th className="num">On order</th>
                  <th className="num">Reorder pt</th>
                  <th className="num">Safety</th>
                  <th className="num">Suggested</th>
                  <th className="num">Last cost</th>
                  <th>Vendor</th>
                  <th className="num">Lead</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.itemId}>
                    <td>
                      <input type="checkbox" name="itemId" value={r.itemId} defaultChecked={!!r.preferredVendorId} disabled={!r.preferredVendorId} />
                    </td>
                    <td>
                      <Link href={`/items/${r.itemId}`} className="font-medium text-brand hover:underline">
                        {r.sku}
                      </Link>{" "}
                      <span className="text-ink-3">{r.name}</span>
                    </td>
                    <td className="num">{fmtQty(r.onHand)}</td>
                    <td className="num">{fmtQty(r.demand)}</td>
                    <td className="num">{fmtQty(r.onOrder)}</td>
                    <td className="num">{fmtQty(r.reorderPoint)}</td>
                    <td className="num">{fmtQty(r.safetyStock)}</td>
                    <td className="num font-semibold">{fmtQty(r.suggestedQty)}</td>
                    <td className="num">{fmtMoney(r.lastCost)}</td>
                    <td>{vendorName(r.preferredVendorId) ?? <span className="text-warn">no preferred vendor</span>}</td>
                    <td className="num">{r.leadTimeDays} d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="mt-3 flex items-center gap-3">
            <Button type="submit">Create POs for selected (one per vendor)</Button>
            <span className="text-xs text-ink-3">Items without a preferred vendor: set one on the item, or raise the PO by hand.</span>
          </div>
        </form>
      ) : (
        <EmptyState title="Nothing to buy" hint="Stock and open POs cover every reorder point and open work order." />
      )}
    </>
  );
}
