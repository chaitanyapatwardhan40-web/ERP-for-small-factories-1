import Papa from "papaparse";
import * as XLSX from "xlsx";

export type Sheet = { name: string; headers: string[]; rows: Record<string, string>[] };

/** Read CSV/TSV/XLSX bytes into header + string rows. Blank rows are dropped. */
export function parseSpreadsheet(filename: string, data: Buffer): Sheet[] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm")) {
    const wb = XLSX.read(data, { type: "buffer", cellDates: false });
    return wb.SheetNames.map((name) => {
      const ws = wb.Sheets[name];
      const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, raw: false, defval: "" });
      return fromMatrix(name, matrix.map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c)))));
    });
  }
  const text = data.toString("utf8").replace(/^﻿/, "");
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  return [fromMatrix(filename, parsed.data)];
}

function fromMatrix(name: string, matrix: string[][]): Sheet {
  // The header row is the first row with at least two non-empty cells.
  const headerIdx = matrix.findIndex((r) => r.filter((c) => String(c).trim()).length >= 2);
  if (headerIdx < 0) return { name, headers: [], rows: [] };
  const rawHeaders = matrix[headerIdx].map((h, i) => (String(h).trim() ? String(h).trim() : `Column ${i + 1}`));
  // De-duplicate repeated headers.
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h) => {
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    return n ? `${h} (${n + 1})` : h;
  });
  const rows: Record<string, string>[] = [];
  for (const r of matrix.slice(headerIdx + 1)) {
    if (!r.some((c) => String(c).trim())) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = String(r[i] ?? "").trim()));
    rows.push(row);
  }
  return { name, headers, rows };
}

export function toNumber(v: string | undefined): number | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (s === "" || s === "-") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
