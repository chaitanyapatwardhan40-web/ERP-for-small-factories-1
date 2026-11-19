"use client";

import { useState } from "react";

export type PickItem = { id: string; sku: string; name: string; type: string; salesPrice: number; standardCost: number; lastCost: number; avgCost: number };

type Mode = "quote" | "order" | "po";

export type LineRow = {
  key: number;
  itemId: string;
  description: string;
  qty: string;
  unitPrice: string;
  materialCost: string;
  laborCost: string;
  outsideCost: string;
  overheadCost: string;
  marginPct: string;
  leadTimeDays: string;
  discountPct: string;
  promisedDate: string;
  expectedDate: string;
  vendorPartNo: string;
  notes: string;
  /** True while the price came from the price list, so it follows the quantity. */
  autoPrice?: boolean;
};

export type PriceHint = { price: number; partNo?: string | null; breaks?: { minQty: number; price: number }[] };

/** The list price for a quantity: the highest break at or below it, else the base price. */
export function hintPrice(hint: PriceHint | undefined, qty: number): number | null {
  if (!hint) return null;
  if (hint.breaks?.length) {
    const hit = [...hint.breaks].filter((b) => b.minQty <= Math.max(qty, 1)).sort((a, b) => b.minQty - a.minQty)[0];
    if (hit) return hit.price;
    return null;
  }
  return hint.price;
}

let seq = 1;
const blank = (marginPct: string): LineRow => ({
  key: seq++,
  itemId: "",
  description: "",
  qty: "1",
  unitPrice: "",
  materialCost: "",
  laborCost: "",
  outsideCost: "",
  overheadCost: "",
  marginPct,
  leadTimeDays: "14",
  discountPct: "",
  promisedDate: "",
  expectedDate: "",
  vendorPartNo: "",
  notes: "",
});

const cell = "w-full rounded border border-line bg-white px-2 py-1 text-sm";
const numCell = `${cell} text-right`;

/**
 * Repeating line rows for quotes, orders and POs. Writes inputs named
 * lines[i][field] so the server action can parse them with formLines().
 * Blank prices are resolved on the server from the price list (orders,
 * quotes) or the vendor's price list (POs).
 */
export function LineEditor({
  items,
  mode,
  defaultMarginPct = 30,
  overheadPct = 0,
  initial,
  priceHints,
}: {
  items: PickItem[];
  mode: Mode;
  defaultMarginPct?: number;
  overheadPct?: number;
  initial?: Partial<LineRow>[];
  /** itemId -> price or cost from a price list, shown as the placeholder. */
  priceHints?: Record<string, PriceHint>;
}) {
  const [rows, setRows] = useState<LineRow[]>(
    initial?.length ? initial.map((r) => ({ ...blank(String(defaultMarginPct)), ...r })) : [blank(String(defaultMarginPct))],
  );
  const update = (key: number, patch: Partial<LineRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const listPrice = (itemId: string, qty: string) => {
    const it = items.find((i) => i.id === itemId);
    const fromList = hintPrice(priceHints?.[itemId], Number(qty || 1));
    if (fromList != null) return String(fromList);
    if (!it) return "";
    if (mode === "po") return String(it.lastCost || it.standardCost || "");
    return it.salesPrice ? String(it.salesPrice) : "";
  };
  const pick = (key: number, itemId: string) => {
    const it = items.find((i) => i.id === itemId);
    if (!it) return update(key, { itemId, description: "" });
    const row = rows.find((r) => r.key === key);
    const unitPrice = listPrice(itemId, row?.qty ?? "1");
    const cost = it.standardCost || it.avgCost || it.lastCost || 0;
    if (mode === "quote") {
      update(key, { itemId, description: it.name, materialCost: String(cost), laborCost: "", outsideCost: "", overheadCost: "", unitPrice, autoPrice: true });
    } else if (mode === "order") {
      update(key, { itemId, description: it.name, unitPrice, autoPrice: true });
    } else {
      update(key, { itemId, description: it.name, unitPrice, vendorPartNo: priceHints?.[itemId]?.partNo ?? "", autoPrice: true });
    }
  };
  const setQty = (r: LineRow, qty: string) => {
    // A price that came from the list follows the quantity breaks; a typed price stays.
    update(r.key, r.autoPrice && r.itemId ? { qty, unitPrice: listPrice(r.itemId, qty) } : { qty });
  };
  const priceOf = (r: LineRow) => {
    if (r.unitPrice) return Number(r.unitPrice);
    if (mode === "quote") {
      const cost = Number(r.materialCost || 0) + Number(r.laborCost || 0) + Number(r.outsideCost || 0) + Number(r.overheadCost || 0);
      const m = Math.min(99, Math.max(0, Number(r.marginPct || 0)));
      return cost ? cost / (1 - m / 100) : 0;
    }
    return hintPrice(priceHints?.[r.itemId], Number(r.qty || 1)) ?? 0;
  };
  const extOf = (r: LineRow) => Number(r.qty || 0) * priceOf(r) * (1 - Math.min(100, Math.max(0, Number(r.discountPct || 0))) / 100);
  const total = rows.reduce((s, r) => s + extOf(r), 0);
  const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

  return (
    <div className="space-y-2">
      <table className="data">
        <thead>
          <tr>
            <th className="w-52">Item</th>
            <th>Description</th>
            {mode === "po" ? <th className="w-28">Vendor p/n</th> : null}
            <th className="num w-20">Qty</th>
            {mode === "quote" ? (
              <>
                <th className="num w-20">Material</th>
                <th className="num w-20">Labour</th>
                <th className="num w-20">Outside</th>
                <th className="num w-20">Overhead</th>
                <th className="num w-16">Margin %</th>
                <th className="num w-16">Lead d</th>
              </>
            ) : null}
            <th className="num w-24">{mode === "po" ? "Unit cost" : "Unit price"}</th>
            {mode !== "po" ? <th className="num w-16">Disc %</th> : null}
            {mode === "order" ? <th className="w-32">Promised</th> : null}
            {mode === "po" ? <th className="w-32">Need by</th> : null}
            <th className="num w-24">Ext.</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key}>
              <td>
                <select name={`lines[${i}][itemId]`} value={r.itemId} onChange={(e) => pick(r.key, e.target.value)} className={cell} required={mode === "order"}>
                  <option value="">{mode === "quote" ? "— custom —" : mode === "po" ? "— non-stock —" : "Select item"}</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.sku} · {it.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input name={`lines[${i}][description]`} value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} className={cell} required={!r.itemId} placeholder={r.itemId ? "" : mode === "po" ? "Freight, tooling, outside work…" : "Describe the line"} />
              </td>
              {mode === "po" ? (
                <td>
                  <input name={`lines[${i}][vendorPartNo]`} value={r.vendorPartNo} onChange={(e) => update(r.key, { vendorPartNo: e.target.value })} className={cell} />
                </td>
              ) : null}
              <td>
                <input name={`lines[${i}][qty]`} type="number" step="0.0001" min="0" value={r.qty} onChange={(e) => setQty(r, e.target.value)} className={numCell} required />
              </td>
              {mode === "quote" ? (
                <>
                  {(["materialCost", "laborCost", "outsideCost", "overheadCost", "marginPct", "leadTimeDays"] as const).map((f) => (
                    <td key={f}>
                      <input name={`lines[${i}][${f}]`} type="number" step={f === "leadTimeDays" ? "1" : "0.01"} value={r[f]} onChange={(e) => update(r.key, { [f]: e.target.value })} className={numCell} />
                    </td>
                  ))}
                </>
              ) : null}
              <td>
                <input
                  name={`lines[${i}][unitPrice]`}
                  type="number"
                  step="0.0001"
                  min="0"
                  value={r.unitPrice}
                  placeholder={mode === "quote" ? priceOf(r).toFixed(2) : (hintPrice(priceHints?.[r.itemId], Number(r.qty || 1)) ?? "price list").toString()}
                  onChange={(e) => update(r.key, { unitPrice: e.target.value, autoPrice: false })}
                  className={numCell}
                  required={mode === "po" && !r.itemId}
                />
              </td>
              {mode !== "po" ? (
                <td>
                  <input name={`lines[${i}][discountPct]`} type="number" step="0.01" min="0" max="100" value={r.discountPct} onChange={(e) => update(r.key, { discountPct: e.target.value })} className={numCell} />
                </td>
              ) : null}
              {mode === "order" ? (
                <td>
                  <input name={`lines[${i}][promisedDate]`} type="date" value={r.promisedDate} onChange={(e) => update(r.key, { promisedDate: e.target.value })} className={cell} />
                </td>
              ) : null}
              {mode === "po" ? (
                <td>
                  <input name={`lines[${i}][expectedDate]`} type="date" value={r.expectedDate} onChange={(e) => update(r.key, { expectedDate: e.target.value })} className={cell} />
                </td>
              ) : null}
              <td className="num tabular-nums">{money(extOf(r))}</td>
              <td>
                <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="text-xs text-ink-3 hover:text-bad" aria-label="Remove line">
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setRows((rs) => [...rs, blank(String(defaultMarginPct))])} className="text-sm text-brand hover:underline">
          + Add line
        </button>
        <div className="text-sm">
          {mode === "quote" && overheadPct ? <span className="mr-4 text-xs text-ink-3">Overhead {overheadPct}% of labour</span> : null}
          Lines <strong className="tabular-nums">{money(total)}</strong>
        </div>
      </div>
    </div>
  );
}
