import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { uuidOr404 } from "@/lib/ids";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { purchaseOrderLines, purchaseOrders } from "@/lib/db/schema";
import { pickItems, pickVendors } from "@/lib/pick";
import { PageHeader } from "@/components/ui/page";
import { PoForm } from "@/components/forms/po-form";
import { vendorPriceList } from "@/modules/purchasing/service";

export const metadata = { title: "Edit purchase order" };

export default async function EditPoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [po] = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.orgId, ctx.orgId)));
  if (!po) notFound();
  const [lines, vendorList, itemList, prices] = await Promise.all([
    db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id)).orderBy(asc(purchaseOrderLines.lineNo)),
    pickVendors(db, ctx.orgId),
    pickItems(db, ctx.orgId),
    vendorPriceList(db, ctx.orgId, po.vendorId),
  ]);
  const priceHints = Object.fromEntries(prices.map((p) => [p.vi.itemId, { price: Number(p.vi.lastCost), partNo: p.vi.vendorPartNo }]));
  return (
    <>
      <PageHeader
        title={`Edit ${po.number}`}
        description={po.status === "draft" ? "Draft" : `Saving creates revision ${po.revision + 1}`}
        crumbs={[
          { href: "/purchasing", label: "Purchase orders" },
          { href: `/purchasing/${po.id}`, label: po.number },
        ]}
      />
      <PoForm vendors={vendorList} items={itemList} po={po} lines={lines} priceHints={priceHints} />
    </>
  );
}
