import { date, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { base, ts } from "./_shared";
import { orgs } from "./platform";
import { workCenters } from "./items";

export const assets = pgTable("assets", {
  ...base,
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  workCenterId: uuid("work_center_id").references(() => workCenters.id, {
    onDelete: "set null",
  }),
  serial: text("serial"),
  purchasedAt: date("purchased_at"),
  status: text("status", { enum: ["running", "down", "retired"] })
    .notNull()
    .default("running"),
});

export const maintenanceTasks = pgTable("maintenance_tasks", {
  ...base,
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  intervalDays: integer("interval_days").notNull().default(90),
  lastDoneAt: date("last_done_at"),
  nextDueAt: date("next_due_at"),
  instructions: text("instructions"),
});

export const downtimeLogs = pgTable("downtime_logs", {
  ...base,
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" }),
  startedAt: ts("started_at").notNull().defaultNow(),
  endedAt: ts("ended_at"),
  reason: text("reason").notNull(),
  notes: text("notes"),
});
