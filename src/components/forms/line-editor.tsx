"use client";

import { useState } from "react";

export type PickItem = { id: string; sku: string; name: string; type: string; salesPrice: number; standardCost: number; lastCost: number; avgCost: number };

type Mode = "quote" | "order" | "po";

type Row = {
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
};

let seq = 1;
const blank = (marginPct: string): Row => ({
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
});

/**
 * Repeating line rows for quotes, orders and POs. Writes hidden inputs
 * named lines[i][field] so the server action can parse them with formLines().
 */
export function LineEditor({
  items,
  mode,
  defaultMarginPct = 30,
  overheadPct = 0,
  initial,
}: {
  items: PickItem[];
  mode: Mode;
  defaultMarginPct?: number;
  overheadPct?: number;
  initial?: Partial<Row>[];
}) {
  const [rows, setRows] = useState<Row[]>(
    initial?.length ? initial.map((r) => ({ ...blank(String(defaultMarginPct)), ...r })) : [blank(String(defaultMarginPct))],
  );
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const pick = (key: number, itemId: string) => {
    const it = items.find((i) => i.id === itemId);
    if (!it) return update(key, { itemId });
    const cost = it.standardCost || it.avgCost || it.lastCost || 0;
    if (mode === "quote") {
      update(key, {
        itemId,
        description: it.name,
        materialCost: it.type === "buy" ? String(cost) : String(cost),
        laborCost: "",
        outsideCost: "",
        overheadCost: "",
        unitPrice: it.salesPrice ? String(it.salesPrice) : "",
      });
    } else if (mode === "order") {
      update(key, { itemId, description: it.name, unitPrice: String(it.salesPrice || "") });
    } else {
      update(key, { itemId, description: it.name, unitPrice: String(it.lastCost || it.standardCost || "") });
    }
  };
  const priceOf = (r: Row) => {
    if (r.unitPrice) return Number(r.unitPrice);
    const cost = Number(r.materialCost || 0) + Number(r.laborCost || 0) + Number(r.outsideCost || 0) + Number(r.overheadCost || 0);
    const m = Math.min(99, Math.max(0, Number(r.marginPct || 0)));
    return cost ? cost / (1 - m / 100) : 0;
  };
  const total = rows.reduce((s, r) => s + Number(r.qty || 0) * priceOf(r), 0);
  const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

  return (
    <div className="space-y-2">
      <table className="data">
        <thead>
          <tr>
            <th className="w-56">Item</th>
            <th>Description</th>
            <th className="num w-24">Qty</th>
            {mode === "quote" ? (
              <>
                <th className="num w-24">Material</th>
                <th className="num w-24">Labour</th>
                <th className="num w-24">Outside</th>
                <th className="num w-24">Overhead</th>
                <th className="num w-20">Margin %</th>
                <th className="num w-20">Lead d</th>
              </>
            ) : null}
            <th className="num w-28">{mode === "po" ? "Unit cost" : "Unit price"}</th>
            <th className="num w-28">Ext.</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key}>
              <td>
                <select
                  name={`lines[${i}][itemId]`}
                  value={r.itemId}
                  onChange={(e) => pick(r.key, e.target.value)}
                  className="w-full rounded border border-line bg-white px-2 py-1 text-sm"
                  required={mode !== "quote"}
                >
                  <option value="">{mode === "quote" ? "— custom —" : "Select item"}</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.sku} · {it.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input name={`lines[${i}][description]`} value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} className="w-full rounded border border-line px-2 py-1 text-sm" required={mode === "quote"} />
              </td>
              <td>
                <input name={`lines[${i}][qty]`} type="number" step="0.0001" min="0" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} className="w-full rounded border border-line px-2 py-1 text-right text-sm" required />
              </td>
              {mode === "quote" ? (
                <>
                  {(["materialCost", "laborCost", "outsideCost", "overheadCost", "marginPct", "leadTimeDays"] as const).map((f) => (
                    <td key={f}>
                      <input
                        name={`lines[${i}][${f}]`}
                        type="number"
                        step={f === "leadTimeDays" ? "1" : "0.01"}
                        value={r[f]}
                        onChange={(e) => update(r.key, { [f]: e.target.value })}
                        className="w-full rounded border border-line px-2 py-1 text-right text-sm"
                      />
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
                  placeholder={mode === "quote" ? priceOf(r).toFixed(2) : ""}
                  onChange={(e) => update(r.key, { unitPrice: e.target.value })}
                  className="w-full rounded border border-line px-2 py-1 text-right text-sm"
                  required={mode !== "quote"}
                />
              </td>
              <td className="num tabular-nums">{money(Number(r.qty || 0) * priceOf(r))}</td>
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
          Total <strong className="tabular-nums">{money(total)}</strong>
        </div>
      </div>
    </div>
  );
}
