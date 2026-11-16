import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { sequences } from "@/lib/db/schema";

const PREFIX: Record<string, string> = {
  quote: "Q",
  order: "SO",
  po: "PO",
  receipt: "RC",
  wo: "WO",
  shipment: "SH",
  invoice: "INV",
  payment: "PAY",
  bill: "BILL",
  vpayment: "VP",
  journal: "JE",
  ncr: "NCR",
  capa: "CAPA",
  customer: "C",
  vendor: "V",
};

/**
 * Atomic per-org counter: SO-00001, SO-00002... Safe under concurrency because
 * the upsert runs in one statement and returns the value it reserved.
 */
export async function nextNumber(db: DbOrTx, orgId: string, key: string): Promise<string> {
  const [row] = await db
    .insert(sequences)
    .values({ orgId, key, nextValue: 2 })
    .onConflictDoUpdate({
      target: [sequences.orgId, sequences.key],
      set: { nextValue: sql`${sequences.nextValue} + 1` },
    })
    .returning({ nextValue: sequences.nextValue });
  const n = (row?.nextValue ?? 2) - 1;
  const prefix = PREFIX[key] ?? key.toUpperCase();
  return `${prefix}-${String(n).padStart(5, "0")}`;
}
