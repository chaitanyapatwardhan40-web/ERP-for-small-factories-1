import { notFound } from "next/navigation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** Detail pages call this before querying so a bad id is a 404, not a database error. */
export function uuidOr404(id: string): string {
  if (!isUuid(id)) notFound();
  return id;
}
