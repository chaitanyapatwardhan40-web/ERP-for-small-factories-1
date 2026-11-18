import Link from "next/link";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { stockSummary } from "@/modules/inventory/service";
import { Card, EmptyState, PageHeader, Badge, Tabs } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { fmtMoney, fmtQty } from "@/lib/money";
import { ITEM_TABS } from "./tabs";

export const metadata = { title: "Items" };

export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const { q, type } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  let rows = await stockSummary(db, ctx.orgId);
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) => r.sku.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle));
  }
  if (type) rows = rows.filter((r) => r.type === type);
  return (
    <>
      <PageHeader title="Items, BOMs and routings" description={`${rows.length} items`} actions={<LinkButton href="/items/new">New item</LinkButton>} />
      <Tabs tabs={ITEM_TABS} current="/items" />
      <form className="mb-3 flex gap-2">
        <input name="q" defaultValue={q ?? ""} placeholder="Search SKU or name" className="w-64 rounded border border-line bg-white px-3 py-1.5 text-sm" />
        <select name="type" defaultValue={type ?? ""} className="rounded border border-line bg-white px-2 py-1.5 text-sm">
          <option value="">All types</option>
          <option value="make">Make</option>
          <option value="buy">Buy</option>
          <option value="phantom">Phantom</option>
          <option value="service">Service</option>
        </select>
        <button className="rounded border border-line bg-white px-3 py-1.5 text-sm">Filter</button>
      </form>
      {rows.length ? (
        <Card padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Type</th>
                <th>UoM</th>
                <th className="num">On hand</th>
                <th className="num">Avg cost</th>
                <th className="num">Stock value</th>
                <th className="num">Reorder pt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.itemId}>
                  <td>
                    <Link href={`/items/${r.itemId}`} className="font-medium text-brand hover:underline">
                      {r.sku}
                    </Link>
                  </td>
                  <td>{r.name}</td>
                  <td>
                    <Badge tone={r.type === "make" ? "info" : "neutral"}>{r.type}</Badge>
                  </td>
                  <td>{r.uom}</td>
                  <td className={`num ${r.onHand < Number(r.reorderPoint) ? "text-warn" : ""}`}>{fmtQty(r.onHand)}</td>
                  <td className="num">{fmtMoney(r.avgCost)}</td>
                  <td className="num">{fmtMoney(r.value)}</td>
                  <td className="num">{fmtQty(r.reorderPoint)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState title="No items yet" hint="Create parts and assemblies, or import your item list." action={<LinkButton href="/items/new">New item</LinkButton>} />
      )}
    </>
  );
}
