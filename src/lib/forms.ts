import { z } from "zod";

/** FormData -> plain object. Empty strings become undefined so optional fields work. */
export function formObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("$")) continue; // next.js internals
    if (typeof v !== "string") continue;
    if (k.includes("[")) continue; // line arrays are parsed separately
    out[k] = v === "" ? undefined : v;
  }
  return out;
}

/**
 * Parse repeated line inputs named like lines[0][itemId], lines[0][qty] into
 * an array of objects. Rows with no values at all are dropped.
 */
export function formLines(formData: FormData, prefix = "lines"): Record<string, string | undefined>[] {
  const rows = new Map<number, Record<string, string | undefined>>();
  const re = new RegExp(`^${prefix}\\[(\\d+)\\]\\[(\\w+)\\]$`);
  for (const [k, v] of formData.entries()) {
    const m = k.match(re);
    if (!m || typeof v !== "string") continue;
    const idx = Number(m[1]);
    const row = rows.get(idx) ?? {};
    row[m[2]] = v === "" ? undefined : v;
    rows.set(idx, row);
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, r]) => r)
    .filter((r) => Object.values(r).some((v) => v !== undefined));
}

export const num = z.coerce.number();
export const optNum = z.preprocess((v) => (v === undefined || v === "" ? undefined : v), z.coerce.number().optional());
export const optStr = z.string().trim().optional();
export const reqStr = z.string().trim().min(1, "Required");
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const optDate = z.preprocess((v) => (v === undefined || v === "" ? undefined : v), dateStr.optional());
export const bool = z.preprocess((v) => v === "on" || v === "true" || v === "1", z.boolean());

/** Turn a Zod error into one readable line. */
export function zodMessage(err: z.ZodError): string {
  const first = err.issues[0];
  const path = first.path.join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

/** Run a handler and translate thrown errors into the form's { error } shape. */
export async function withFormErrors<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof z.ZodError) return { error: zodMessage(e) };
    if (isRedirectError(e)) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg };
  }
}

function isRedirectError(e: unknown): boolean {
  return typeof e === "object" && e !== null && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT");
}
