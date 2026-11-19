import Link from "@/components/ui/link";
import { uuidOr404 } from "@/lib/ids";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { activities, contacts, items, ncrs, purchaseOrders, vendorBills, vendors } from "@/lib/db/schema";
import { Card, DL, PageHeader, StatusBadge } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { ActivityCard, ContactsCard } from "@/components/forms/party-side";
import { VendorPriceListCard } from "@/components/forms/price-list";
import { vendorPriceList, poTotal, PO_OPEN_STATUSES } from "@/modules/purchasing/service";
import { pickItems } from "@/lib/pick";
import { formatAddress } from "@/lib/forms";
import { fmtDate, fmtMoney } from "@/lib/money";

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [v] = await db.select().from(vendors).where(and(eq(vendors.id, id), eq(vendors.orgId, ctx.orgId)));
  if (!v) notFound();
  const [pos, bills, supplied, openNcrs, cts, acts, prices, itemList] = await Promise.all([
    db.select().from(purchaseOrders).where(eq(purchaseOrders.vendorId, v.id)).orderBy(desc(purchaseOrders.orderDate)).limit(20),
    db.select().from(vendorBills).where(eq(vendorBills.vendorId, v.id)).orderBy(desc(vendorBills.billDate)).limit(20),
    db.select().from(items).where(and(eq(items.orgId, ctx.orgId), eq(items.preferredVendorId, v.id))),
    db.select().from(ncrs).where(and(eq(ncrs.vendorId, v.id), eq(ncrs.status, "open"))),
    db.select().from(contacts).where(and(eq(contacts.partyType, "vendor"), eq(contacts.partyId, v.id))),
    db.select().from(activities).where(and(eq(activities.partyType, "vendor"), eq(activities.partyId, v.id))).orderBy(desc(activities.at)).limit(20),
    vendorPriceList(db, ctx.orgId, v.id),
    pickItems(db, ctx.orgId),
  ]);
  const onOrder = pos.filter((p) => (PO_OPEN_STATUSES as readonly string[]).includes(p.status)).reduce((s, p) => s + poTotal(p), 0);
  const confirmed = pos.filter((p) => p.confirmedDate && p.expectedDate);
  const onTime = confirmed.filter((p) => p.confirmedDate! <= p.expectedDate!).length;
  const openAp = bills.filter((b) => b.status === "approved").reduce((s, b) => s + Number(b.total) - Number(b.amountPaid), 0);
  return (
    <>
      <PageHeader
        title={v.name}
        description={`${v.code} · Net ${v.termsDays} · ${v.leadTimeDays} day lead time`}
        crumbs={[{ href: "/vendors", label: "Vendors" }]}
        actions={
          <>
            <LinkButton href={`/purchasing/new?vendorId=${v.id}`} variant="secondary">
              New PO
            </LinkButton>
            <LinkButton href={`/bills/new?vendorId=${v.id}`} variant="secondary">
              New bill
            </LinkButton>
            <LinkButton href={`/vendors/${v.id}/edit`}>Edit</LinkButton>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Details">
            <DL
              rows={[
                ["Email", v.email],
                ["Phone", v.phone],
                ["Website", v.website],
                ["Address", formatAddress(v.address).join(", ") || "—"],
                ["Our account #", v.accountNo],
                ["Pays by", v.paymentMethod],
                ["Ship via", v.shipVia],
                ["Minimum order", Number(v.minOrder) ? fmtMoney(v.minOrder) : null],
                ["1099", v.is1099 ? `Yes${v.taxId ? ` · ${v.taxId}` : ""}` : "No"],
                ["On order", fmtMoney(onOrder)],
                ["Open payables", fmtMoney(openAp)],
                ["Confirmed on time", confirmed.length ? `${onTime}/${confirmed.length} POs` : "no confirmations yet"],
                ["Open NCRs", openNcrs.length],
                ["Preferred for", supplied.map((i) => i.sku).join(", ") || "—"],
                ["Rating", v.rating != null ? `${Number(v.rating).toFixed(0)} / 100` : null],
                ["Notes", v.notes],
              ]}
            />
          </Card>
          <VendorPriceListCard
            vendorId={v.id}
            items={itemList}
            rows={prices.map((p) => ({ id: p.vi.id, itemId: p.vi.itemId, sku: p.sku, name: p.name, vendorPartNo: p.vi.vendorPartNo, lastCost: Number(p.vi.lastCost), leadTimeDays: p.vi.leadTimeDays, minQty: Number(p.vi.minQty), preferred: p.vi.preferred, lastPurchasedAt: p.vi.lastPurchasedAt }))}
          />
          <Card title="Purchase orders" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Date</th>
                  <th>Expected</th>
                  <th>Status</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {pos.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/purchasing/${p.id}`} className="font-medium text-brand hover:underline">
                        {p.number}
                      </Link>
                    </td>
                    <td>{fmtDate(p.orderDate)}</td>
                    <td>{fmtDate(p.expectedDate)}</td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="num">{fmtMoney(poTotal(p))}</td>
                  </tr>
                ))}
                {!pos.length ? (
                  <tr>
                    <td colSpan={5} className="text-ink-3">
                      No purchase orders yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
          <Card title="Bills" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Date</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th className="num">Total</th>
                  <th className="num">Paid</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/bills/${b.id}`} className="font-medium text-brand hover:underline">
                        {b.number}
                      </Link>
                    </td>
                    <td>{fmtDate(b.billDate)}</td>
                    <td>{fmtDate(b.dueDate)}</td>
                    <td>
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="num">{fmtMoney(b.total)}</td>
                    <td className="num">{fmtMoney(b.amountPaid)}</td>
                  </tr>
                ))}
                {!bills.length ? (
                  <tr>
                    <td colSpan={6} className="text-ink-3">
                      No bills yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
        </div>
        <div className="space-y-4">
          <ContactsCard partyType="vendor" partyId={v.id} rows={cts} />
          <ActivityCard partyType="vendor" partyId={v.id} rows={acts} />
        </div>
      </div>
    </>
  );
}
