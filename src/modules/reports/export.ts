import { and, asc, desc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { customers, items, vendorBills, vendors } from "@/lib/db/schema";
import { listOrders, listQuotes } from "@/modules/sales/service";
import { listPurchaseOrders, poTotal } from "@/modules/purchasing/service";
import { listWorkOrders } from "@/modules/production/service";
import { stockSummary } from "@/modules/inventory/service";
import { journalExport } from "@/modules/books/extras";
import { invoices } from "@/lib/db/schema";

export type Export = { filename: string; columns: string[]; rows: (string | number | null | undefined)[][] };

/** Rows for the CSV export of a list screen, honouring the same filters. */
export async function exportRows(db: DbOrTx, orgId: string, kind: string, p: Record<string, string | undefined>): Promise<Export | null> {
  switch (kind) {
    case "orders": {
      const rows = await listOrders(db, orgId, { status: p.status, q: p.q, program: p.program, customerId: p.customerId });
      return { filename: "sales-orders", columns: ["Order", "Customer", "Customer PO", "Program", "Ordered", "Requested", "Promised", "Status", "Value"], rows: rows.map((r) => [r.number, r.customerName, r.customerPo, r.program, r.orderDate, r.requestedDate, r.promisedDate, r.status, Number(r.subtotal)]) };
    }
    case "quotes": {
      const rows = await listQuotes(db, orgId, { status: p.status, q: p.q });
      return { filename: "quotes", columns: ["Quote", "Customer", "RFQ", "Date", "Valid until", "Status", "Revision", "Value"], rows: rows.map((r) => [r.q.number, r.customerName, r.q.customerRfq, r.q.quoteDate, r.q.validUntil, r.q.status, r.q.revision, Number(r.q.subtotal)]) };
    }
    case "purchase-orders": {
      const rows = await listPurchaseOrders(db, orgId, { status: p.status, vendorId: p.vendorId, q: p.q });
      return { filename: "purchase-orders", columns: ["PO", "Vendor", "Vendor ref", "Ordered", "Expected", "Confirmed", "Status", "Lines", "Freight", "Tax", "Total"], rows: rows.map((r) => [r.number, r.vendorName, r.vendorRef, r.orderDate, r.expectedDate, r.confirmedDate, r.status, Number(r.subtotal), Number(r.freight), Number(r.tax), poTotal(r)]) };
    }
    case "work-orders": {
      const rows = await listWorkOrders(db, orgId, undefined, p.q);
      return { filename: "work-orders", columns: ["WO", "Item", "Name", "Qty", "Complete", "Due", "Priority", "Status", "Material", "Labour", "Outside", "Overhead"], rows: rows.map((r) => [r.number, r.sku, r.itemName, Number(r.qty), Number(r.qtyComplete), r.dueDate, r.priority, r.status, Number(r.materialCost), Number(r.laborCost), Number(r.outsideCost), Number(r.overheadCost)]) };
    }
    case "customers": {
      const rows = await db.select().from(customers).where(eq(customers.orgId, orgId)).orderBy(asc(customers.name));
      return { filename: "customers", columns: ["Code", "Name", "Email", "Phone", "Terms", "Credit limit", "Discount %", "Tax exempt", "Sales rep", "City", "State", "Active"], rows: rows.map((c) => [c.code, c.name, c.email, c.phone, c.termsDays, Number(c.creditLimit), Number(c.discountPct), c.taxExempt ? "yes" : "no", c.salesRep, c.billingAddress?.city, c.billingAddress?.state, c.active ? "yes" : "no"]) };
    }
    case "vendors": {
      const rows = await db.select().from(vendors).where(eq(vendors.orgId, orgId)).orderBy(asc(vendors.name));
      return { filename: "vendors", columns: ["Code", "Name", "Email", "Phone", "Terms", "Lead days", "1099", "Tax ID", "City", "State", "Rating", "Active"], rows: rows.map((v) => [v.code, v.name, v.email, v.phone, v.termsDays, v.leadTimeDays, v.is1099 ? "yes" : "no", v.taxId, v.address?.city, v.address?.state, v.rating == null ? null : Number(v.rating), v.active ? "yes" : "no"]) };
    }
    case "items": {
      const rows = await db.select().from(items).where(eq(items.orgId, orgId)).orderBy(asc(items.sku));
      return { filename: "items", columns: ["SKU", "Name", "Type", "UoM", "Category", "Standard cost", "Avg cost", "Last cost", "Sales price", "Reorder point", "Reorder qty", "Safety stock", "Lead days", "Revision", "Drawing", "Status"], rows: rows.map((i) => [i.sku, i.name, i.type, i.uom, i.category, Number(i.standardCost), Number(i.avgCost), Number(i.lastCost), Number(i.salesPrice), Number(i.reorderPoint), Number(i.reorderQty), Number(i.safetyStock), i.leadTimeDays, i.revision, i.drawingNumber, i.status]) };
    }
    case "inventory": {
      const rows = await stockSummary(db, orgId);
      return { filename: "inventory", columns: ["SKU", "Name", "Type", "On hand", "Avg cost", "Value", "Reorder point"], rows: rows.map((r) => [r.sku, r.name, r.type, r.onHand, r.avgCost, r.value, Number(r.reorderPoint)]) };
    }
    case "invoices": {
      const rows = await db
        .select({ i: invoices, customerName: customers.name })
        .from(invoices)
        .innerJoin(customers, eq(customers.id, invoices.customerId))
        .where(and(eq(invoices.orgId, orgId), p.status ? eq(invoices.status, p.status as "issued" | "paid" | "void" | "draft") : undefined))
        .orderBy(desc(invoices.issueDate));
      return { filename: "invoices", columns: ["Invoice", "Kind", "Customer", "Issued", "Due", "Status", "Subtotal", "Tax", "Total", "Paid", "Open"], rows: rows.map((r) => [r.i.number, r.i.kind, r.customerName, r.i.issueDate, r.i.dueDate, r.i.status, Number(r.i.subtotal), Number(r.i.tax), Number(r.i.total), Number(r.i.amountPaid), Number(r.i.total) - Number(r.i.amountPaid)]) };
    }
    case "bills": {
      const rows = await db.select({ b: vendorBills, vendorName: vendors.name }).from(vendorBills).innerJoin(vendors, eq(vendors.id, vendorBills.vendorId)).where(eq(vendorBills.orgId, orgId)).orderBy(desc(vendorBills.billDate));
      return { filename: "vendor-bills", columns: ["Bill", "Vendor", "Vendor ref", "Date", "Due", "Status", "Subtotal", "Tax", "Freight", "Total", "Paid"], rows: rows.map((r) => [r.b.number, r.vendorName, r.b.vendorRef, r.b.billDate, r.b.dueDate, r.b.status, Number(r.b.subtotal), Number(r.b.tax), Number(r.b.freight), Number(r.b.total), Number(r.b.amountPaid)]) };
    }
    case "journal": {
      const t = new Date().toISOString().slice(0, 10);
      const rows = await journalExport(db, orgId, p.from ?? `${t.slice(0, 4)}-01-01`, p.to ?? t);
      return { filename: "journal", columns: ["Date", "Entry", "Memo", "Event", "Account code", "Account", "Debit", "Credit", "Line memo", "Status"], rows: rows.map((r) => [r.date, r.number, r.memo, r.event, r.code, r.account, Number(r.debit), Number(r.credit), r.lineMemo, r.status]) };
    }
    default:
      return null;
  }
}

export function toCsv(e: Export) {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v) : v;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [e.columns.map(esc).join(","), ...e.rows.map((r) => r.map(esc).join(","))].join("\n") + "\n";
}
