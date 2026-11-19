import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { base, money, pct, qty, ts } from "./_shared";
import { orgs } from "./platform";
import { vendors } from "./parties";

export const ITEM_TYPES = ["make", "buy", "phantom", "service"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const workCenters = pgTable(
  "work_centers",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    hourlyRate: money("hourly_rate").notNull().default(0),
    capacityHoursPerDay: qty("capacity_hours_per_day").notNull().default(8),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("work_centers_org_code").on(t.orgId, t.code)],
);

export const locations = pgTable(
  "locations",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type", {
      enum: ["stock", "wip", "staging", "shipping", "quarantine"],
    })
      .notNull()
      .default("stock"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("locations_org_code").on(t.orgId, t.code)],
);

export const items = pgTable(
  "items",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type", { enum: ITEM_TYPES }).notNull().default("buy"),
    uom: text("uom").notNull().default("ea"),
    status: text("status", { enum: ["active", "obsolete"] })
      .notNull()
      .default("active"),
    /** Rolled-up standard cost (material + labour + outside + overhead). */
    standardCost: money("standard_cost").notNull().default(0),
    /** Moving weighted-average cost of stock on hand. */
    avgCost: money("avg_cost").notNull().default(0),
    lastCost: money("last_cost").notNull().default(0),
    salesPrice: money("sales_price").notNull().default(0),
    reorderPoint: qty("reorder_point").notNull().default(0),
    reorderQty: qty("reorder_qty").notNull().default(0),
    leadTimeDays: integer("lead_time_days").notNull().default(0),
    preferredVendorId: uuid("preferred_vendor_id").references(() => vendors.id, {
      onDelete: "set null",
    }),
    defaultLocationId: uuid("default_location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
    trackLots: boolean("track_lots").notNull().default(false),
    revision: text("revision").notNull().default("A"),
    drawingNumber: text("drawing_number"),
    category: text("category"),
    barcode: text("barcode"),
    weight: qty("weight").notNull().default(0),
    safetyStock: qty("safety_stock").notNull().default(0),
    minOrderQty: qty("min_order_qty").notNull().default(0),
    shelfLifeDays: integer("shelf_life_days"),
    custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [uniqueIndex("items_org_sku").on(t.orgId, t.sku)],
);

export const bomRevisions = pgTable(
  "bom_revisions",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    rev: text("rev").notNull().default("A"),
    status: text("status", { enum: ["draft", "active", "obsolete"] })
      .notNull()
      .default("draft"),
    notes: text("notes"),
    effectiveFrom: ts("effective_from"),
  },
  (t) => [uniqueIndex("bom_rev_item_rev").on(t.orgId, t.itemId, t.rev)],
);

export const bomLines = pgTable(
  "bom_lines",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    bomRevisionId: uuid("bom_revision_id")
      .notNull()
      .references(() => bomRevisions.id, { onDelete: "cascade" }),
    componentItemId: uuid("component_item_id")
      .notNull()
      .references(() => items.id),
    qty: qty("qty").notNull().default(1),
    scrapPct: pct("scrap_pct").notNull().default(0),
    position: integer("position").notNull().default(10),
    refDes: text("ref_des"),
    notes: text("notes"),
  },
  (t) => [index("bom_lines_rev").on(t.bomRevisionId)],
);

export const routings = pgTable(
  "routings",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    rev: text("rev").notNull().default("A"),
    status: text("status", { enum: ["draft", "active", "obsolete"] })
      .notNull()
      .default("draft"),
    notes: text("notes"),
  },
  (t) => [uniqueIndex("routings_item_rev").on(t.orgId, t.itemId, t.rev)],
);

export const routingOperations = pgTable(
  "routing_operations",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    routingId: uuid("routing_id")
      .notNull()
      .references(() => routings.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull().default(10),
    name: text("name").notNull(),
    workCenterId: uuid("work_center_id").references(() => workCenters.id, {
      onDelete: "set null",
    }),
    setupHours: qty("setup_hours").notNull().default(0),
    /** Run time per unit, in hours. */
    runHoursPerUnit: qty("run_hours_per_unit").notNull().default(0),
    /** Outside processing (plating, heat treat): vendor and cost per unit. */
    outsideVendorId: uuid("outside_vendor_id").references(() => vendors.id, {
      onDelete: "set null",
    }),
    outsideCostPerUnit: money("outside_cost_per_unit").notNull().default(0),
    instructions: text("instructions"),
  },
  (t) => [index("routing_ops_routing").on(t.routingId)],
);
