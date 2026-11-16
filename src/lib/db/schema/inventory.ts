import { pgTable, text, uuid, index } from "drizzle-orm/pg-core";
import { base, money, qty, ts } from "./_shared";
import { orgs, users } from "./platform";
import { items, locations } from "./items";

export const TXN_TYPES = [
  "receipt", // purchase receipt into stock (+)
  "issue", // material issued to a work order (-)
  "complete", // finished goods completed from a work order (+)
  "ship", // shipped to a customer (-)
  "adjust", // count / manual adjustment (+/-)
  "move_out", // transfer between locations (-)
  "move_in", // transfer between locations (+)
  "scrap", // scrapped (-)
  "return", // customer return (+)
] as const;
export type TxnType = (typeof TXN_TYPES)[number];

/**
 * The heart of the system. Append-only: a mistake is corrected by a new
 * transaction with the opposite sign, never by editing. Every other module
 * writes here, and the general ledger posts from the same event.
 */
export const inventoryTransactions = pgTable(
  "inventory_transactions",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    lotNumber: text("lot_number"),
    /** Signed quantity: positive into the location, negative out. */
    qty: qty("qty").notNull(),
    /** Unit cost used for this movement (weighted average at the time). */
    unitCost: money("unit_cost").notNull().default(0),
    type: text("type", { enum: TXN_TYPES }).notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    memo: text("memo"),
    postedAt: ts("posted_at").notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    journalEntryId: uuid("journal_entry_id"),
  },
  (t) => [
    index("inv_txn_item").on(t.orgId, t.itemId),
    index("inv_txn_ref").on(t.orgId, t.refType, t.refId),
  ],
);
