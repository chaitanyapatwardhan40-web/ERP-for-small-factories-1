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
import { base, qty, ts } from "./_shared";
import { orgs, users } from "./platform";
import { items } from "./items";
import { vendors } from "./parties";

export type ChecklistItem = {
  name: string;
  type: "measurement" | "visual" | "document";
  unit?: string;
  min?: number;
  max?: number;
};

export type Measurement = {
  name: string;
  value?: number | string;
  pass: boolean;
};

export const inspectionPlans = pgTable("inspection_plans", {
  ...base,
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  stage: text("stage", { enum: ["incoming", "in_process", "final"] }).notNull(),
  itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }),
  checklist: jsonb("checklist").$type<ChecklistItem[]>().notNull().default([]),
  sampleSize: integer("sample_size").notNull().default(1),
});

export const inspections = pgTable(
  "inspections",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").references(() => inspectionPlans.id, {
      onDelete: "set null",
    }),
    stage: text("stage", { enum: ["incoming", "in_process", "final"] }).notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    qtyInspected: qty("qty_inspected").notNull().default(1),
    qtyRejected: qty("qty_rejected").notNull().default(0),
    result: text("result", { enum: ["pass", "fail"] }).notNull(),
    measurements: jsonb("measurements").$type<Measurement[]>().notNull().default([]),
    inspectedBy: uuid("inspected_by").references(() => users.id, {
      onDelete: "set null",
    }),
    inspectedAt: ts("inspected_at").notNull().defaultNow(),
    notes: text("notes"),
  },
  (t) => [index("inspections_ref").on(t.orgId, t.refType, t.refId)],
);

export const ncrs = pgTable(
  "ncrs",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    source: text("source", {
      enum: ["incoming", "in_process", "final", "customer"],
    }).notNull(),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    vendorId: uuid("vendor_id").references(() => vendors.id, {
      onDelete: "set null",
    }),
    workOrderId: uuid("work_order_id"),
    qty: qty("qty").notNull().default(1),
    description: text("description").notNull(),
    disposition: text("disposition", {
      enum: ["pending", "use_as_is", "rework", "scrap", "return_to_vendor"],
    })
      .notNull()
      .default("pending"),
    status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
    openedBy: uuid("opened_by").references(() => users.id, { onDelete: "set null" }),
    closedAt: ts("closed_at"),
  },
  (t) => [uniqueIndex("ncrs_org_number").on(t.orgId, t.number)],
);

export const capas = pgTable(
  "capas",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    ncrId: uuid("ncr_id").references(() => ncrs.id, { onDelete: "set null" }),
    rootCause: text("root_cause"),
    correctiveAction: text("corrective_action").notNull(),
    owner: text("owner"),
    dueDate: date("due_date"),
    status: text("status", { enum: ["open", "verified", "closed"] })
      .notNull()
      .default("open"),
  },
  (t) => [uniqueIndex("capas_org_number").on(t.orgId, t.number)],
);

export const gauges = pgTable("gauges", {
  ...base,
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  serial: text("serial"),
  calibrationIntervalDays: integer("calibration_interval_days").notNull().default(365),
  lastCalibratedAt: date("last_calibrated_at"),
  nextDueAt: date("next_due_at"),
  status: text("status", { enum: ["in_service", "due", "out_of_service"] })
    .notNull()
    .default("in_service"),
});
