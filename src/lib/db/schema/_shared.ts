import { numeric, timestamp, uuid } from "drizzle-orm/pg-core";

/** Primary key + timestamps every table carries. */
export const base = {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

/** Quantities: 4 decimals is enough for pieces, feet, kg and hours. */
export const qty = (name: string) =>
  numeric(name, { precision: 14, scale: 4, mode: "number" });

/** Unit costs and prices: 4 decimals; totals are rounded to 2 at display. */
export const money = (name: string) =>
  numeric(name, { precision: 14, scale: 4, mode: "number" });

/** Percentages stored as 0-100 with 2 decimals. */
export const pct = (name: string) =>
  numeric(name, { precision: 7, scale: 2, mode: "number" });

export const ts = (name: string) =>
  timestamp(name, { withTimezone: true });
