import { Card } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/fields";
import { deleteVendorItemAction, saveVendorItemAction } from "@/modules/purchasing/actions";
import { deleteCustomerPriceAction, saveCustomerPriceAction } from "@/modules/parties/actions";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/money";
import type { PickItem } from "@/components/forms/line-editor";

type VendorPriceRow = { id: string; itemId: string; sku: string; name: string; vendorPartNo: string | null; lastCost: number; leadTimeDays: number | null; minQty: number; preferred: boolean; lastPurchasedAt: string | null };

export function VendorPriceListCard({ vendorId, rows, items }: { vendorId: string; rows: VendorPriceRow[]; items: PickItem[] }) {
  return (
    <Card title="Price list" padded={false}>
      <table className="data">
        <thead>
          <tr>
            <th>Item</th>
            <th>Vendor p/n</th>
            <th className="num">Last cost</th>
            <th className="num">Lead d</th>
            <th className="num">Min qty</th>
            <th>Last bought</th>
            <th>Preferred</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.sku} <span className="text-ink-3">{r.name}</span>
              </td>
              <td>{r.vendorPartNo}</td>
              <td className="num">{fmtMoney(r.lastCost)}</td>
              <td className="num">{r.leadTimeDays ?? "—"}</td>
              <td className="num">{fmtQty(r.minQty)}</td>
              <td>{fmtDate(r.lastPurchasedAt)}</td>
              <td>{r.preferred ? "Yes" : ""}</td>
              <td>
                <form action={deleteVendorItemAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="vendorId" value={vendorId} />
                  <button className="text-xs text-ink-3 hover:text-bad" type="submit">
                    Remove
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={8} className="text-ink-3">
                No prices yet. Receiving a PO adds the item here automatically.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <ActionForm action={saveVendorItemAction} className="flex flex-wrap items-end gap-2 border-t border-line p-3">
        <input type="hidden" name="vendorId" value={vendorId} />
        <div className="min-w-56 flex-1">
          <span className="mb-1 block text-xs text-ink-2">Item</span>
          <Select name="itemId" required defaultValue="">
            <option value="">Select item</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.sku} · {i.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-32">
          <span className="mb-1 block text-xs text-ink-2">Vendor p/n</span>
          <Input name="vendorPartNo" />
        </div>
        <div className="w-28">
          <span className="mb-1 block text-xs text-ink-2">Cost</span>
          <Input name="lastCost" type="number" step="0.0001" min="0" />
        </div>
        <div className="w-20">
          <span className="mb-1 block text-xs text-ink-2">Lead d</span>
          <Input name="leadTimeDays" type="number" min="0" />
        </div>
        <div className="w-24">
          <span className="mb-1 block text-xs text-ink-2">Min qty</span>
          <Input name="minQty" type="number" step="0.0001" min="0" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="preferred" /> Preferred
        </label>
        <SubmitButton size="sm">Add / update</SubmitButton>
      </ActionForm>
    </Card>
  );
}

type CustomerPriceRow = { id: string; itemId: string; sku: string; name: string; minQty: number; unitPrice: number; validFrom: string | null; validTo: string | null; customerId: string | null };

export function CustomerPriceListCard({ customerId, rows, items, returnTo, title = "Price list" }: { customerId?: string; rows: CustomerPriceRow[]; items: PickItem[]; returnTo: string; title?: string }) {
  return (
    <Card title={title} padded={false}>
      <table className="data">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">From qty</th>
            <th className="num">Unit price</th>
            <th>Valid</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.sku} <span className="text-ink-3">{r.name}</span>
                {customerId && !r.customerId ? <span className="ml-1 text-xs text-ink-3">(general)</span> : null}
              </td>
              <td className="num">{fmtQty(r.minQty)}</td>
              <td className="num">{fmtMoney(r.unitPrice)}</td>
              <td className="text-ink-3">{r.validFrom || r.validTo ? `${fmtDate(r.validFrom) || "…"} – ${fmtDate(r.validTo) || "…"}` : "always"}</td>
              <td>
                {(!customerId || r.customerId) ? (
                  <form action={deleteCustomerPriceAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <button className="text-xs text-ink-3 hover:text-bad" type="submit">
                      Remove
                    </button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={5} className="text-ink-3">
                No special prices; the item&apos;s list price applies.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <ActionForm action={saveCustomerPriceAction} className="flex flex-wrap items-end gap-2 border-t border-line p-3">
        {customerId ? <input type="hidden" name="customerId" value={customerId} /> : null}
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="min-w-56 flex-1">
          <span className="mb-1 block text-xs text-ink-2">Item</span>
          <Select name="itemId" required defaultValue="">
            <option value="">Select item</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.sku} · {i.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-24">
          <span className="mb-1 block text-xs text-ink-2">From qty</span>
          <Input name="minQty" type="number" step="0.0001" min="0" defaultValue={0} />
        </div>
        <div className="w-28">
          <span className="mb-1 block text-xs text-ink-2">Unit price</span>
          <Input name="unitPrice" type="number" step="0.0001" min="0" required />
        </div>
        <div className="w-36">
          <span className="mb-1 block text-xs text-ink-2">Valid from</span>
          <Input name="validFrom" type="date" />
        </div>
        <div className="w-36">
          <span className="mb-1 block text-xs text-ink-2">Valid to</span>
          <Input name="validTo" type="date" />
        </div>
        <SubmitButton size="sm">Add price</SubmitButton>
      </ActionForm>
    </Card>
  );
}
