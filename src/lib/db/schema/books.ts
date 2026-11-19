import {
  jsonb,
  boolean,
  date,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { base, money, pct, qty, ts } from "./_shared";
import { orgs } from "./platform";
import { customers, vendors } from "./parties";
import { items } from "./items";
import { salesOrders } from "./sales";
import { purchaseOrderLines, purchaseOrders } from "./purchasing";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;

/**
 * Account subtypes are what posting rules point at, so a shop can rename or
 * renumber its chart without breaking a single rule.
 */
export const ACCOUNT_SUBTYPES = [
  "cash",
  "accounts_receivable",
  "inventory",
  "wip",
  "fixed_assets",
  "accounts_payable",
  "accrued_purchases",
  "accrued_payroll",
  "sales_tax_payable",
  "owner_equity",
  "retained_earnings",
  "revenue",
  "cogs",
  "labor_absorbed",
  "overhead_absorbed",
  "inventory_adjustment",
  "scrap_expense",
  "operating_expense",
  "payroll_expense",
  "other",
] as const;
export type AccountSubtype = (typeof ACCOUNT_SUBTYPES)[number];

export const accounts = pgTable(
  "accounts",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type", { enum: ACCOUNT_TYPES }).notNull(),
    subtype: text("subtype", { enum: ACCOUNT_SUBTYPES }).notNull().default("other"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("accounts_org_code").on(t.orgId, t.code)],
);

/**
 * event -> debit subtype / credit subtype. Seeded per org, editable by an
 * accountant. The posting service refuses to post an event with no rule.
 */
export const postingRules = pgTable(
  "posting_rules",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    debitSubtype: text("debit_subtype", { enum: ACCOUNT_SUBTYPES }).notNull(),
    creditSubtype: text("credit_subtype", { enum: ACCOUNT_SUBTYPES }).notNull(),
    description: text("description"),
  },
  (t) => [uniqueIndex("posting_rules_org_event").on(t.orgId, t.event)],
);

export const periods = pgTable(
  "periods",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    locked: boolean("locked").notNull().default(false),
  },
  (t) => [index("periods_org").on(t.orgId, t.startDate)],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    entryDate: date("entry_date").notNull(),
    memo: text("memo"),
    /** The business event that produced this entry. */
    event: text("event"),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    status: text("status", { enum: ["posted", "reversed"] })
      .notNull()
      .default("posted"),
    reversesId: uuid("reverses_id"),
  },
  (t) => [
    uniqueIndex("journal_entries_org_number").on(t.orgId, t.number),
    index("journal_entries_source").on(t.orgId, t.sourceType, t.sourceId),
  ],
);

export const journalLines = pgTable(
  "journal_lines",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    debit: money("debit").notNull().default(0),
    credit: money("credit").notNull().default(0),
    memo: text("memo"),
  },
  (t) => [index("journal_lines_entry").on(t.entryId), index("journal_lines_account").on(t.accountId)],
);

// ---------------------------------------------------------------------------
// Receivables
// ---------------------------------------------------------------------------

export const invoices = pgTable(
  "invoices",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    orderId: uuid("order_id").references(() => salesOrders.id, {
      onDelete: "set null",
    }),
    shipmentId: uuid("shipment_id"),
    status: text("status", { enum: ["draft", "issued", "paid", "void"] })
      .notNull()
      .default("draft"),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date").notNull(),
    subtotal: money("subtotal").notNull().default(0),
    taxRatePct: pct("tax_rate_pct").notNull().default(0),
    tax: money("tax").notNull().default(0),
    total: money("total").notNull().default(0),
    amountPaid: money("amount_paid").notNull().default(0),
    notes: text("notes"),
    kind: text("kind", { enum: ["invoice", "credit_memo"] }).notNull().default("invoice"),
    creditOfInvoiceId: uuid("credit_of_invoice_id"),
    freight: money("freight").notNull().default(0),
    termsDays: integer("terms_days"),
    memo: text("memo"),
  },
  (t) => [uniqueIndex("invoices_org_number").on(t.orgId, t.number)],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull().default(1),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    qty: qty("qty").notNull().default(1),
    unitPrice: money("unit_price").notNull().default(0),
    amount: money("amount").notNull().default(0),
  },
  (t) => [index("invoice_lines_invoice").on(t.invoiceId)],
);

export const customerPayments = pgTable(
  "customer_payments",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    invoiceId: uuid("invoice_id").references(() => invoices.id, {
      onDelete: "set null",
    }),
    amount: money("amount").notNull(),
    paidAt: date("paid_at").notNull(),
    method: text("method", { enum: ["check", "ach", "card", "cash", "other"] })
      .notNull()
      .default("check"),
    reference: text("reference"),
    unapplied: money("unapplied").notNull().default(0),
    memo: text("memo"),
  },
  (t) => [uniqueIndex("customer_payments_org_number").on(t.orgId, t.number)],
);

// ---------------------------------------------------------------------------
// Payables
// ---------------------------------------------------------------------------

export const vendorBills = pgTable(
  "vendor_bills",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    poId: uuid("po_id").references(() => purchaseOrders.id, {
      onDelete: "set null",
    }),
    vendorRef: text("vendor_ref"),
    status: text("status", { enum: ["draft", "approved", "paid", "void"] })
      .notNull()
      .default("draft"),
    billDate: date("bill_date").notNull(),
    dueDate: date("due_date").notNull(),
    subtotal: money("subtotal").notNull().default(0),
    tax: money("tax").notNull().default(0),
    freight: money("freight").notNull().default(0),
    total: money("total").notNull().default(0),
    amountPaid: money("amount_paid").notNull().default(0),
    /** Expense bills (rent, utilities) post here instead of accrued purchases. */
    expenseSubtype: text("expense_subtype", { enum: ACCOUNT_SUBTYPES }),
    notes: text("notes"),
  },
  (t) => [uniqueIndex("vendor_bills_org_number").on(t.orgId, t.number)],
);

export const vendorBillLines = pgTable(
  "vendor_bill_lines",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    billId: uuid("bill_id")
      .notNull()
      .references(() => vendorBills.id, { onDelete: "cascade" }),
    poLineId: uuid("po_line_id").references(() => purchaseOrderLines.id, {
      onDelete: "set null",
    }),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    qty: qty("qty").notNull().default(1),
    unitCost: money("unit_cost").notNull().default(0),
    amount: money("amount").notNull().default(0),
  },
  (t) => [index("vendor_bill_lines_bill").on(t.billId)],
);

export const vendorPayments = pgTable(
  "vendor_payments",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    billId: uuid("bill_id").references(() => vendorBills.id, {
      onDelete: "set null",
    }),
    amount: money("amount").notNull(),
    paidAt: date("paid_at").notNull(),
    method: text("method", { enum: ["check", "ach", "card", "cash", "other"] })
      .notNull()
      .default("check"),
    reference: text("reference"),
  },
  (t) => [uniqueIndex("vendor_payments_org_number").on(t.orgId, t.number)],
);

export const bankTransactions = pgTable("bank_transactions", {
  ...base,
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  postedAt: date("posted_at").notNull(),
  description: text("description").notNull(),
  reference: text("reference"),
  amount: money("amount").notNull(),
  matchedType: text("matched_type"),
  matchedId: uuid("matched_id"),
  reconciled: boolean("reconciled").notNull().default(false),
  importedAt: ts("imported_at").defaultNow(),
});

/** One customer payment can settle several invoices. */
export const customerPaymentApplications = pgTable(
  "customer_payment_applications",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => customerPayments.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amount: money("amount").notNull(),
  },
  (t) => [index("cpa_payment").on(t.paymentId), index("cpa_invoice").on(t.invoiceId)],
);

export type TemplateLine = { accountId: string; debit: number; credit: number; memo?: string };

/** Recurring or reusable journal entries (depreciation, accruals, rent). */
export const journalTemplates = pgTable("journal_templates", {
  ...base,
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  memo: text("memo"),
  lines: jsonb("lines").$type<TemplateLine[]>().notNull().default([]),
  frequency: text("frequency", { enum: ["none", "weekly", "monthly", "quarterly", "yearly"] }).notNull().default("monthly"),
  nextDate: date("next_date"),
  lastPostedAt: date("last_posted_at"),
  active: boolean("active").notNull().default(true),
});

/** Budget per account and month; compared with actuals in reports. */
export const budgets = pgTable(
  "budgets",
  {
    ...base,
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    amount: money("amount").notNull().default(0),
  },
  (t) => [uniqueIndex("budgets_account_period").on(t.orgId, t.accountId, t.year, t.month)],
);
