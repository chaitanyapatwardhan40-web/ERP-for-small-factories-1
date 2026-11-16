import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { base, pct } from "./_shared";
import { orgs } from "./platform";

export type Address = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

export const customers = pgTable(
  "customers",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    termsDays: integer("terms_days").notNull().default(30),
    taxExempt: boolean("tax_exempt").notNull().default(false),
    billingAddress: jsonb("billing_address").$type<Address>(),
    shippingAddress: jsonb("shipping_address").$type<Address>(),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [uniqueIndex("customers_org_code").on(t.orgId, t.code)],
);

export const vendors = pgTable(
  "vendors",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    termsDays: integer("terms_days").notNull().default(30),
    leadTimeDays: integer("lead_time_days").notNull().default(14),
    address: jsonb("address").$type<Address>(),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    /** 0-100, recomputed from on-time receipts and NCRs. */
    rating: pct("rating"),
    custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [uniqueIndex("vendors_org_code").on(t.orgId, t.code)],
);

export const contacts = pgTable("contacts", {
  ...base,
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  partyType: text("party_type", { enum: ["customer", "vendor", "lead"] }).notNull(),
  partyId: uuid("party_id").notNull(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  title: text("title"),
  primary: boolean("primary").notNull().default(false),
});
