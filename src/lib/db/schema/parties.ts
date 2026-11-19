import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { base, money, pct, qty } from "./_shared";
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
    taxCertNo: text("tax_cert_no"),
    creditLimit: money("credit_limit").notNull().default(0),
    creditHold: boolean("credit_hold").notNull().default(false),
    discountPct: pct("discount_pct").notNull().default(0),
    salesRep: text("sales_rep"),
    shipVia: text("ship_via"),
    website: text("website"),
    industry: text("industry"),
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
    accountNo: text("account_no"),
    paymentMethod: text("payment_method", { enum: ["check", "ach", "card", "cash", "other"] }).notNull().default("check"),
    taxId: text("tax_id"),
    is1099: boolean("is_1099").notNull().default(false),
    website: text("website"),
    shipVia: text("ship_via"),
    minOrder: money("min_order").notNull().default(0),
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

/** Extra ship-to / bill-to addresses for a customer. */
export const customerAddresses = pgTable(
  "customer_addresses",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    address: jsonb("address").$type<Address>().notNull().default({}),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => [index("customer_addresses_customer").on(t.customerId)],
);

/** Vendor price list: what each vendor calls an item and last charged for it. */
export const vendorItems = pgTable(
  "vendor_items",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull(),
    vendorPartNo: text("vendor_part_no"),
    lastCost: money("last_cost").notNull().default(0),
    leadTimeDays: integer("lead_time_days"),
    minQty: qty("min_qty").notNull().default(0),
    preferred: boolean("preferred").notNull().default(false),
    lastPurchasedAt: date("last_purchased_at"),
  },
  (t) => [uniqueIndex("vendor_items_vendor_item").on(t.orgId, t.vendorId, t.itemId), index("vendor_items_item").on(t.itemId)],
);

/** Customer-specific (customerId set) or general (customerId null) prices by quantity break. */
export const customerPrices = pgTable(
  "customer_prices",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull(),
    minQty: qty("min_qty").notNull().default(0),
    unitPrice: money("unit_price").notNull(),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
  },
  (t) => [index("customer_prices_item").on(t.orgId, t.itemId)],
);
