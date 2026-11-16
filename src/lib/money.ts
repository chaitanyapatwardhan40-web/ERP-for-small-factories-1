/** Rounding helpers. Money math stays in numbers at 4 dp; display at 2. */
export const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10_000) / 10_000;
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function fmtMoney(n: number | null | undefined, currency = "USD") {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(v);
}

export function fmtQty(n: number | null | undefined) {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(v);
}

export function fmtPct(n: number | null | undefined) {
  return `${Number(n ?? 0).toFixed(1)}%`;
}

export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00` : d) : d;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(d: string | Date | null | undefined) {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** YYYY-MM-DD for today in local time (date columns). */
export function today(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
