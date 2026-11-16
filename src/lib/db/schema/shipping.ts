import { pgTable, text, uniqueIndex, uuid, index } from "drizzle-orm/pg-core";
import { base, qty, ts } from "./_shared";
import { orgs, users } from "./platform";
import { customers } from "./parties";
import { items, locations } from "./items";
import { salesOrderLines, salesOrders } from "./sales";

export const shipments = pgTable(
  "shipments",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    status: text("status", { enum: ["draft", "shipped"] })
      .notNull()
      .default("draft"),
    shippedAt: ts("shipped_at"),
    shippedBy: uuid("shipped_by").references(() => users.id, {
      onDelete: "set null",
    }),
    carrier: text("carrier"),
    tracking: text("tracking"),
    notes: text("notes"),
    invoiceId: uuid("invoice_id"),
  },
  (t) => [uniqueIndex("shipments_org_number").on(t.orgId, t.number)],
);

export const shipmentLines = pgTable(
  "shipment_lines",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    orderLineId: uuid("order_line_id")
      .notNull()
      .references(() => salesOrderLines.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    qty: qty("qty").notNull(),
    lotNumber: text("lot_number"),
    locationId: uuid("location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
  },
  (t) => [index("shipment_lines_shipment").on(t.shipmentId)],
);
