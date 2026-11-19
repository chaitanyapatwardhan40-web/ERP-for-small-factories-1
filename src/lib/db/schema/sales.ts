import {
  date,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { base, money, pct, qty } from "./_shared";
import { orgs, users } from "./platform";
import { customers, type Address } from "./parties";
import { items } from "./items";
import { leads } from "./crm";

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "lost", "expired"] as const;
export const ORDER_STATUSES = [
  "draft",
  "confirmed",
  "in_production",
  "partially_shipped",
  "shipped",
  "invoiced",
  "closed",
  "cancelled",
] as const;

export const quotes = pgTable(
  "quotes",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    status: text("status", { enum: QUOTE_STATUSES }).notNull().default("draft"),
    revision: integer("revision").notNull().default(1),
    quoteDate: date("quote_date").notNull(),
    validUntil: date("valid_until"),
    customerRfq: text("customer_rfq"),
    subtotal: money("subtotal").notNull().default(0),
    notes: text("notes"),
    lostReason: text("lost_reason"),
    convertedOrderId: uuid("converted_order_id"),
    /** The lead this quote answers, when it came from one. */
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    terms: text("terms"),
    discountPct: pct("discount_pct").notNull().default(0),
    contactName: text("contact_name"),
  },
  (t) => [uniqueIndex("quotes_org_number").on(t.orgId, t.number)],
);

export const quoteLines = pgTable(
  "quote_lines",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull().default(1),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    qty: qty("qty").notNull().default(1),
    /** Cost build-up per unit; the unit price is derived from these + margin. */
    materialCost: money("material_cost").notNull().default(0),
    laborCost: money("labor_cost").notNull().default(0),
    outsideCost: money("outside_cost").notNull().default(0),
    overheadCost: money("overhead_cost").notNull().default(0),
    marginPct: pct("margin_pct").notNull().default(30),
    unitPrice: money("unit_price").notNull().default(0),
    leadTimeDays: integer("lead_time_days").notNull().default(14),
    discountPct: pct("discount_pct").notNull().default(0),
    notes: text("notes"),
  },
  (t) => [index("quote_lines_quote").on(t.quoteId)],
);

export const salesOrders = pgTable(
  "sales_orders",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    customerPo: text("customer_po"),
    /** Kitting programs group many orders (one order per kit). */
    program: text("program"),
    status: text("status", { enum: ORDER_STATUSES }).notNull().default("draft"),
    orderDate: date("order_date").notNull(),
    promisedDate: date("promised_date"),
    subtotal: money("subtotal").notNull().default(0),
    notes: text("notes"),
    internalNotes: text("internal_notes"),
    quoteId: uuid("quote_id").references(() => quotes.id, { onDelete: "set null" }),
    requestedDate: date("requested_date"),
    shipTo: jsonb("ship_to").$type<Address>(),
    shipVia: text("ship_via"),
    freight: money("freight").notNull().default(0),
    discountPct: pct("discount_pct").notNull().default(0),
    termsDays: integer("terms_days"),
    salesRep: text("sales_rep"),
    holdReason: text("hold_reason"),
  },
  (t) => [
    uniqueIndex("sales_orders_org_number").on(t.orgId, t.number),
    index("sales_orders_status").on(t.orgId, t.status),
  ],
);

export const salesOrderLines = pgTable(
  "sales_order_lines",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull().default(1),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    description: text("description").notNull(),
    qty: qty("qty").notNull().default(1),
    unitPrice: money("unit_price").notNull().default(0),
    promisedDate: date("promised_date"),
    qtyShipped: qty("qty_shipped").notNull().default(0),
    qtyInvoiced: qty("qty_invoiced").notNull().default(0),
    qtyCancelled: qty("qty_cancelled").notNull().default(0),
    discountPct: pct("discount_pct").notNull().default(0),
    notes: text("notes"),
  },
  (t) => [index("so_lines_order").on(t.orderId)],
);

/** Every change after confirmation is logged, never silently overwritten. */
export const orderChanges = pgTable("order_changes", {
  ...base,
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  orderId: uuid("order_id")
    .notNull()
    .references(() => salesOrders.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>(),
});
