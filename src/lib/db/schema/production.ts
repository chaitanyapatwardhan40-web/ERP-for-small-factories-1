import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { base, money, qty, ts } from "./_shared";
import { orgs, users } from "./platform";
import { bomRevisions, items, routings, workCenters } from "./items";
import { salesOrderLines } from "./sales";
import { vendors } from "./parties";

export const WO_STATUSES = [
  "planned",
  "released",
  "in_progress",
  "complete",
  "closed",
  "cancelled",
] as const;

export const employees = pgTable("employees", {
  ...base,
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  hourlyRate: money("hourly_rate").notNull().default(0),
  /** Short code typed on the shop-floor tablet. */
  badge: text("badge"),
  skills: jsonb("skills").$type<string[]>().notNull().default([]),
  department: text("department"),
  shift: text("shift"),
  hireDate: date("hire_date"),
  email: text("email"),
  phone: text("phone"),
  active: boolean("active").notNull().default(true),
});

export const workOrders = pgTable(
  "work_orders",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    qty: qty("qty").notNull().default(1),
    qtyComplete: qty("qty_complete").notNull().default(0),
    qtyScrap: qty("qty_scrap").notNull().default(0),
    status: text("status", { enum: WO_STATUSES }).notNull().default("planned"),
    priority: integer("priority").notNull().default(5),
    dueDate: date("due_date"),
    startDate: date("start_date"),
    completedAt: ts("completed_at"),
    salesOrderLineId: uuid("sales_order_line_id").references(
      () => salesOrderLines.id,
      { onDelete: "set null" },
    ),
    bomRevisionId: uuid("bom_revision_id").references(() => bomRevisions.id, {
      onDelete: "set null",
    }),
    routingId: uuid("routing_id").references(() => routings.id, {
      onDelete: "set null",
    }),
    /** Accumulated actual cost; posted to WIP as it happens. */
    materialCost: money("material_cost").notNull().default(0),
    laborCost: money("labor_cost").notNull().default(0),
    outsideCost: money("outside_cost").notNull().default(0),
    overheadCost: money("overhead_cost").notNull().default(0),
    notes: text("notes"),
    scheduledStart: date("scheduled_start"),
    scheduledEnd: date("scheduled_end"),
    scrapReason: text("scrap_reason"),
  },
  (t) => [
    uniqueIndex("work_orders_org_number").on(t.orgId, t.number),
    index("work_orders_status").on(t.orgId, t.status),
  ],
);

export const workOrderOperations = pgTable(
  "work_order_operations",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull().default(10),
    name: text("name").notNull(),
    workCenterId: uuid("work_center_id").references(() => workCenters.id, {
      onDelete: "set null",
    }),
    plannedSetupHours: qty("planned_setup_hours").notNull().default(0),
    plannedRunHours: qty("planned_run_hours").notNull().default(0),
    actualHours: qty("actual_hours").notNull().default(0),
    qtyComplete: qty("qty_complete").notNull().default(0),
    qtyScrap: qty("qty_scrap").notNull().default(0),
    status: text("status", { enum: ["pending", "in_progress", "complete"] })
      .notNull()
      .default("pending"),
    outsideVendorId: uuid("outside_vendor_id").references(() => vendors.id, {
      onDelete: "set null",
    }),
    outsideCostPerUnit: money("outside_cost_per_unit").notNull().default(0),
    instructions: text("instructions"),
  },
  (t) => [index("wo_ops_wo").on(t.workOrderId)],
);

export const workOrderMaterials = pgTable(
  "work_order_materials",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    qtyRequired: qty("qty_required").notNull(),
    qtyIssued: qty("qty_issued").notNull().default(0),
  },
  (t) => [index("wo_materials_wo").on(t.workOrderId)],
);

/** One row per clock-in / clock-out on an operation; feeds job cost. */
export const laborEntries = pgTable(
  "labor_entries",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    workOrderOperationId: uuid("work_order_operation_id")
      .notNull()
      .references(() => workOrderOperations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    startedAt: ts("started_at").notNull().defaultNow(),
    endedAt: ts("ended_at"),
    hours: qty("hours").notNull().default(0),
    hourlyRate: money("hourly_rate").notNull().default(0),
    qtyGood: qty("qty_good").notNull().default(0),
    qtyScrap: qty("qty_scrap").notNull().default(0),
    scrapReason: text("scrap_reason"),
    notes: text("notes"),
  },
  (t) => [index("labor_entries_op").on(t.workOrderOperationId)],
);

/** Training records behind the skills matrix; expiry drives the renewal list. */
export const employeeTrainings = pgTable(
  "employee_trainings",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    skill: text("skill").notNull(),
    trainedAt: date("trained_at").notNull(),
    expiresAt: date("expires_at"),
    trainer: text("trainer"),
    notes: text("notes"),
  },
  (t) => [index("employee_trainings_employee").on(t.employeeId)],
);
