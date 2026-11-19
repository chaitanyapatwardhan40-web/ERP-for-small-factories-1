import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { base, ts } from "./_shared";

export const ROLES = ["owner", "office", "shop", "accountant", "readonly"] as const;
export type Role = (typeof ROLES)[number];

/** A tenant: one factory. Every business row carries org_id. */
export const orgs = pgTable("orgs", {
  ...base,
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** currency, fiscal year start month, default terms, tax rate... */
  settings: jsonb("settings").$type<OrgSettings>().notNull().default({}),
});

export type CompanyInfo = {
  legalName?: string;
  address?: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string };
  phone?: string;
  email?: string;
  website?: string;
  taxId?: string;
};

export type OrgSettings = {
  currency?: string;
  fiscalYearStartMonth?: number;
  defaultTermsDays?: number;
  defaultTaxRatePct?: number;
  overheadPct?: number;
  defaultMarginPct?: number;
  timezone?: string;
  /** Percent over the ordered quantity a receipt may exceed (0 = exact). */
  overReceiptPct?: number;
  company?: CompanyInfo;
  /** Standard text printed on documents. */
  documents?: { quoteTerms?: string; poTerms?: string; invoiceTerms?: string; invoiceFooter?: string };
  /** Per-document number prefixes, e.g. { order: "SO", invoice: "INV" }. */
  numbering?: Record<string, string>;
};

export const users = pgTable("users", {
  ...base,
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ROLES }).notNull().default("office"),
  },
  (t) => [uniqueIndex("memberships_org_user").on(t.orgId, t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    ...base,
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The org the user is currently working in. */
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "set null" }),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("sessions_user").on(t.userId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    data: jsonb("data").$type<Record<string, unknown>>(),
  },
  (t) => [index("audit_org_entity").on(t.orgId, t.entityType, t.entityId)],
);

/** Per-org document numbering: SO-00001, PO-00001, WO-00001... */
export const sequences = pgTable(
  "sequences",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    nextValue: integer("next_value").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.key] })],
);

export const units = pgTable(
  "units",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("units_org_code").on(t.orgId, t.code)],
);

/** Files attached to any record. Storage is pluggable (local disk, Vercel Blob, S3). */
export const attachments = pgTable(
  "attachments",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull().default("application/octet-stream"),
    size: integer("size").notNull().default(0),
    storageKey: text("storage_key").notNull(),
    /** Drawing / document revision letter or number. */
    revision: text("revision").notNull().default("A"),
    kind: text("kind").notNull().default("document"),
    note: text("note"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    current: boolean("current").notNull().default(true),
  },
  (t) => [index("attachments_entity").on(t.orgId, t.entityType, t.entityId)],
);
