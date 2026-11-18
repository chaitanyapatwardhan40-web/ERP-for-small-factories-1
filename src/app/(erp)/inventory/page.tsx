import Link from "next/link";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { inventoryLedgerValue, recentTransactions, stockSummary } from "@/modules/inventory/service";
import { balanceOfSubtype } from "@/modules/books/service";
import { Card, PageHeader, Stat, Badge } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { fmtDateTime, fmtMoney, fmtQty } from "@/lib/money";

export const metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ itemId?: string }> }) {
  const { itemId } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const [rows, txns, ledger, gl] = await Promise.all([stockSummary(db, ctx.orgId), recentTransactions(db, ctx.orgId, 200), inventoryLedgerValue(db, ctx.orgId), balanceOfSubtype(db, ctx.orgId, "inventory")]);
  const stocked = rows.filter((r) => Math.abs(r.onHand) > 1e-9);
  const shown = itemId ? txns.filter((t) => rows.find((r) => r.itemId === itemId)?.sku === t.sku) : txns;
  const tied = Math.abs(ledger - gl) < 0.005;
  return (
    <>
      <PageHeader
        title="Inventory"
        actions={
          <>
            <LinkButton href="/inventory/adjust" variant="secondary">
              Count / adjust / move
            </LinkButton>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Stock value (transactions)" value={fmtMoney(ledger)} />
        <Stat label="Inventory account (ledger)" value={fmtMoney(gl)} tone={tied ? "good" : "bad"} hint={tied ? "ties to the cent" : "does not tie: check manual journals"} />
        <Stat label="Items in stock" value={stocked.length} hint={`${rows.filter((r) => r.onHand < Number(r.reorderPoint)).length} below reorder point`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="On hand" padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th>Type</th>
                <th className="num">On hand</th>
                <th className="num">Avg cost</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {stocked.map((r) => (
                <tr key={r.itemId}>
                  <td>
                    <Link href={`/items/${r.itemId}`} className="font-medium text-brand hover:underline">
                      {r.sku}
                    </Link>{" "}
                    <span className="text-ink-3">{r.name}</span>
                  </td>
                  <td>
                    <Badge tone={r.type === "make" ? "info" : "neutral"}>{r.type}</Badge>
                  </td>
                  <td className={`num ${r.onHand < Number(r.reorderPoint) ? "text-warn" : ""}`}>
                    {fmtQty(r.onHand)} {r.uom}
                  </td>
                  <td className="num">{fmtMoney(r.avgCost)}</td>
                  <td className="num">{fmtMoney(r.value)}</td>
                </tr>
              ))}
              {!stocked.length ? (
                <tr>
                  <td colSpan={5} className="text-ink-3">
                    Nothing in stock yet. Receive a PO or post a count.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
        <Card title={itemId ? "Transactions for this item" : "Recent transactions"} padded={false}>
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Item</th>
                <th>Type</th>
                <th>Loc</th>
                <th className="num">Qty</th>
                <th className="num">Unit cost</th>
                <th>Ref</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 100).map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap text-xs">{fmtDateTime(t.postedAt)}</td>
                  <td>{t.sku}</td>
                  <td>{t.type.replace("_", " ")}</td>
                  <td>{t.location}</td>
                  <td className={`num ${Number(t.qty) < 0 ? "text-bad" : "text-good"}`}>{fmtQty(t.qty)}</td>
                  <td className="num">{fmtMoney(t.unitCost)}</td>
                  <td className="text-xs text-ink-3">{t.memo ?? t.refType}</td>
                </tr>
              ))}
              {!shown.length ? (
                <tr>
                  <td colSpan={7} className="text-ink-3">
                    No transactions yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
