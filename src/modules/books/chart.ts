import type { AccountSubtype } from "@/lib/db/schema";

type AccountTemplate = {
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  subtype: AccountSubtype;
};

/** A small-manufacturer chart of accounts. Codes are editable per org. */
export const CHART_TEMPLATE: AccountTemplate[] = [
  { code: "1000", name: "Cash - Operating", type: "asset", subtype: "cash" },
  { code: "1100", name: "Accounts Receivable", type: "asset", subtype: "accounts_receivable" },
  { code: "1200", name: "Inventory", type: "asset", subtype: "inventory" },
  { code: "1250", name: "Work in Process", type: "asset", subtype: "wip" },
  { code: "1500", name: "Machinery & Equipment", type: "asset", subtype: "fixed_assets" },
  { code: "2000", name: "Accounts Payable", type: "liability", subtype: "accounts_payable" },
  { code: "2050", name: "Accrued Purchases (received not billed)", type: "liability", subtype: "accrued_purchases" },
  { code: "2100", name: "Accrued Payroll", type: "liability", subtype: "accrued_payroll" },
  { code: "2200", name: "Sales Tax Payable", type: "liability", subtype: "sales_tax_payable" },
  { code: "3000", name: "Owner's Equity", type: "equity", subtype: "owner_equity" },
  { code: "3900", name: "Retained Earnings", type: "equity", subtype: "retained_earnings" },
  { code: "4000", name: "Sales", type: "revenue", subtype: "revenue" },
  { code: "5000", name: "Cost of Goods Sold", type: "expense", subtype: "cogs" },
  { code: "5100", name: "Labor Absorbed", type: "expense", subtype: "labor_absorbed" },
  { code: "5150", name: "Overhead Absorbed", type: "expense", subtype: "overhead_absorbed" },
  { code: "5200", name: "Inventory Adjustments", type: "expense", subtype: "inventory_adjustment" },
  { code: "5300", name: "Scrap", type: "expense", subtype: "scrap_expense" },
  { code: "6000", name: "Operating Expenses", type: "expense", subtype: "operating_expense" },
  { code: "6100", name: "Payroll Expense", type: "expense", subtype: "payroll_expense" },
];

export type PostingRuleTemplate = {
  event: string;
  debit: AccountSubtype;
  credit: AccountSubtype;
  description: string;
};

/**
 * Every business event the system posts, and which side of the ledger it
 * touches. Edit per org in Books > Posting rules; the code never hard-codes
 * an account.
 */
export const DEFAULT_RULES: PostingRuleTemplate[] = [
  { event: "purchase.receipt", debit: "inventory", credit: "accrued_purchases", description: "Goods received against a PO" },
  { event: "purchase.bill", debit: "accrued_purchases", credit: "accounts_payable", description: "Vendor bill for received goods" },
  { event: "purchase.expense_bill", debit: "operating_expense", credit: "accounts_payable", description: "Vendor bill with no PO (rent, utilities)" },
  { event: "purchase.payment", debit: "accounts_payable", credit: "cash", description: "Vendor paid" },
  { event: "production.issue", debit: "wip", credit: "inventory", description: "Material issued to a work order" },
  { event: "production.return", debit: "inventory", credit: "wip", description: "Unused material returned from a work order" },
  { event: "production.labor", debit: "wip", credit: "labor_absorbed", description: "Labour clocked on a work order" },
  { event: "production.overhead", debit: "wip", credit: "overhead_absorbed", description: "Overhead applied to a work order" },
  { event: "production.outside", debit: "wip", credit: "accrued_purchases", description: "Outside processing received" },
  { event: "production.complete", debit: "inventory", credit: "wip", description: "Finished goods completed" },
  { event: "production.scrap", debit: "scrap_expense", credit: "wip", description: "Scrap written off a work order" },
  { event: "sales.ship", debit: "cogs", credit: "inventory", description: "Goods shipped to a customer" },
  { event: "sales.invoice", debit: "accounts_receivable", credit: "revenue", description: "Customer invoiced" },
  { event: "sales.tax", debit: "accounts_receivable", credit: "sales_tax_payable", description: "Sales tax on an invoice" },
  { event: "sales.payment", debit: "cash", credit: "accounts_receivable", description: "Customer payment received" },
  { event: "sales.credit_memo", debit: "revenue", credit: "accounts_receivable", description: "Credit memo issued to a customer" },
  { event: "sales.return", debit: "inventory", credit: "cogs", description: "Customer return put back in stock" },
  { event: "sales.write_off", debit: "operating_expense", credit: "accounts_receivable", description: "Uncollectible receivable written off" },
  { event: "inventory.opening", debit: "inventory", credit: "owner_equity", description: "Opening stock when going live" },
  { event: "inventory.adjust_up", debit: "inventory", credit: "inventory_adjustment", description: "Count found more than the book" },
  { event: "inventory.adjust_down", debit: "inventory_adjustment", credit: "inventory", description: "Count found less than the book" },
  { event: "inventory.scrap", debit: "scrap_expense", credit: "inventory", description: "Stock scrapped" },
];
