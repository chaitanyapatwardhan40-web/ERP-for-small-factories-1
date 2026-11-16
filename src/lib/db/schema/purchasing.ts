import {
  date,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { base, money, qty, ts } from "./_shared";
import { orgs, users } from "./platform";
import { vendors } from "./parties";
import { items, locations } from "./items";

export const PO_STATUSES = [
  "draft",
  "sent",
  "confirmed",
  "partially_received",
  "received",
  "closed",
  "cancelled",
] as const;

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    status: text("status", { enum: PO_STATUSES }).notNull().default("draft"),
    orderDate: date("order_date").notNull(),
    expectedDate: date("expected_date"),
    confirmedDate: date("confirmed_date"),
    vendorRef: text("vendor_ref"),
    subtotal: money("subtotal").notNull().default(0),
    notes: text("notes"),
    /** Set for outside-processing POs raised from a work order operation. */
    workOrderId: uuid("work_order_id"),
  },
  (t) => [
    uniqueIndex("purchase_orders_org_number").on(t.orgId, t.number),
    index("purchase_orders_status").on(t.orgId, t.status),
  ],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    poId: uuid("po_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull().default(1),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    description: text("description").notNull(),
    qty: qty("qty").notNull().default(1),
    unitCost: money("unit_cost").notNull().default(0),
    qtyReceived: qty("qty_received").notNull().default(0),
    qtyBilled: qty("qty_billed").notNull().default(0),
    expectedDate: date("expected_date"),
  },
  (t) => [index("po_lines_po").on(t.poId)],
);

export const receipts = pgTable(
  "receipts",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    poId: uuid("po_id")
      .notNull()
      .references(() => purchaseOrders.id),
    receivedAt: ts("received_at").notNull().defaultNow(),
    receivedBy: uuid("received_by").references(() => users.id, {
      onDelete: "set null",
    }),
    packingSlip: text("packing_slip"),
    notes: text("notes"),
  },
  (t) => [uniqueIndex("receipts_org_number").on(t.orgId, t.number)],
);

export const receiptLines = pgTable(
  "receipt_lines",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    poLineId: uuid("po_line_id")
      .notNull()
      .references(() => purchaseOrderLines.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    qty: qty("qty").notNull(),
    unitCost: money("unit_cost").notNull().default(0),
    lotNumber: text("lot_number"),
    locationId: uuid("location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
    inspectionStatus: text("inspection_status", {
      enum: ["not_required", "pending", "passed", "failed"],
    })
      .notNull()
      .default("not_required"),
  },
  (t) => [index("receipt_lines_receipt").on(t.receiptId)],
);
