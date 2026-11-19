import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { pickItems, pickVendors } from "@/lib/pick";
import { PageHeader } from "@/components/ui/page";
import { PoForm } from "@/components/forms/po-form";
import { companyShipTo, vendorPriceList } from "@/modules/purchasing/service";

export const metadata = { title: "New purchase order" };

export default async function NewPoPage({ searchParams }: { searchParams: Promise<{ vendorId?: string; itemId?: string; workOrderId?: string; qty?: string }> }) {
  const { vendorId, itemId, workOrderId, qty } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const [vendorList, itemList, shipTo, prices] = await Promise.all([
    pickVendors(db, ctx.orgId),
    pickItems(db, ctx.orgId),
    companyShipTo(db, ctx.orgId),
    vendorId ? vendorPriceList(db, ctx.orgId, vendorId) : Promise.resolve([]),
  ]);
  const priceHints = Object.fromEntries(prices.map((p) => [p.vi.itemId, { price: Number(p.vi.lastCost), partNo: p.vi.vendorPartNo }]));
  const picked = itemId ? itemList.find((i) => i.id === itemId) : undefined;
  const initialLines = picked ? [{ itemId: picked.id, description: picked.name, qty: qty ?? "1", unitPrice: priceHints[picked.id] ? String(priceHints[picked.id].price) : String(picked.lastCost || picked.standardCost || "") }] : undefined;
  return (
    <>
      <PageHeader title="New purchase order" crumbs={[{ href: "/purchasing", label: "Purchase orders" }]} description={workOrderId ? "Outside processing" : undefined} />
      <PoForm vendors={vendorList} items={itemList} defaults={{ vendorId, workOrderId, initialLines }} priceHints={priceHints} shipTo={shipTo} />
    </>
  );
}
