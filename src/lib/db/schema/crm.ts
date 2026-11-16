import { jsonb, pgTable, text, uuid, index } from "drizzle-orm/pg-core";
import { base, money, ts } from "./_shared";
import { orgs, users } from "./platform";
import { customers } from "./parties";

export const LEAD_STAGES = ["new", "contacted", "quoting", "won", "lost"] as const;

export const leads = pgTable(
  "leads",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    company: text("company").notNull(),
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    source: text("source"),
    stage: text("stage", { enum: LEAD_STAGES }).notNull().default("new"),
    estimatedValue: money("estimated_value").notNull().default(0),
    nextActionAt: ts("next_action_at"),
    nextAction: text("next_action"),
    notes: text("notes"),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("leads_stage").on(t.orgId, t.stage)],
);

export const activities = pgTable(
  "activities",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    partyType: text("party_type", { enum: ["customer", "vendor", "lead"] }).notNull(),
    partyId: uuid("party_id").notNull(),
    type: text("type", { enum: ["call", "email", "meeting", "note", "visit"] })
      .notNull()
      .default("note"),
    summary: text("summary").notNull(),
    at: ts("at").notNull().defaultNow(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("activities_party").on(t.orgId, t.partyType, t.partyId)],
);

export const campaigns = pgTable("campaigns", {
  ...base,
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type", { enum: ["reactivation", "newsletter", "announcement"] })
    .notNull()
    .default("reactivation"),
  status: text("status", { enum: ["draft", "sent"] }).notNull().default("draft"),
  subject: text("subject"),
  body: text("body"),
  /** Customer ids targeted when the campaign was built. */
  audience: jsonb("audience").$type<string[]>().notNull().default([]),
  sentAt: ts("sent_at"),
});
