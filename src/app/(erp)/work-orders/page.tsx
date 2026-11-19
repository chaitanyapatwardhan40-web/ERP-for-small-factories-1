import Link from "@/components/ui/link";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { listWorkOrders } from "@/modules/production/service";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { fmtDate, fmtMoney, fmtQty, today } from "@/lib/money";

export const metadata = { title: "Work orders" };

const FILTERS: [string, string, string[]][] = [
  ["open", "Open", ["planned", "released", "in_progress"]],
  ["planned", "Planned", ["planned"]],
  ["floor", "On the floor", ["released", "in_progress"]],
  ["done", "Complete", ["complete", "closed"]],
  ["all", "All", []],
];

export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  const sp = await searchParams;
  const { f } = sp;
  const ctx = await requireOrg();
  const db = await getDb();
  const filter = FILTERS.find((x) => x[0] === (f ?? "open")) ?? FILTERS[0];
  const rows = await listWorkOrders(db, ctx.orgId, filter[2], sp.q);
  const t = today();
  return (
    <>
      <PageHeader title="Work orders" description={`${rows.length} ${filter[1].toLowerCase()}`} actions={<LinkButton href="/work-orders/new">New work order</LinkButton>} />
      <div className="mb-3 flex gap-1">
        {FILTERS.map(([v, label]) => (
          <Link key={v} href={`/work-orders?f=${v}`} className={`rounded-full border px-3 py-1 text-xs ${filter[0] === v ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-white text-ink-2"}`}>
            {label}
          </Link>
        ))}
      </div>
      <ListToolbar action="/work-orders" q={sp.q} exportKind="work-orders" params={{ f: sp.f, q: sp.q }} />
      {rows.length ? (
        <Card padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>WO</th>
                <th>Item</th>
                <th className="num">Qty</th>
                <th className="num">Done</th>
                <th>Due</th>
                <th className="num">Pri</th>
                <th>Status</th>
                <th className="num">Cost so far</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  <td>
                    <Link href={`/work-orders/${w.id}`} className="font-medium text-brand hover:underline">
                      {w.number}
                    </Link>
                  </td>
                  <td>
                    {w.sku} <span className="text-ink-3">{w.itemName}</span>
                  </td>
                  <td className="num">{fmtQty(w.qty)}</td>
                  <td className="num">{fmtQty(w.qtyComplete)}</td>
                  <td className={w.dueDate && w.dueDate < t && !["complete", "closed", "cancelled"].includes(w.status) ? "font-medium text-bad" : ""}>{fmtDate(w.dueDate)}</td>
                  <td className="num">{w.priority}</td>
                  <td>
                    <StatusBadge status={w.status} />
                  </td>
                  <td className="num">{fmtMoney(Number(w.materialCost) + Number(w.laborCost) + Number(w.outsideCost) + Number(w.overheadCost))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState title="No work orders" hint="Create one for a make item, or from a confirmed sales order." action={<LinkButton href="/work-orders/new">New work order</LinkButton>} />
      )}
    </>
  );
}
