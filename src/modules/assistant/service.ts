import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import {
  assets,
  customers,
  downtimeLogs,
  employees,
  gauges,
  invoices,
  items,
  laborEntries,
  locations,
  maintenanceTasks,
  ncrs,
  purchaseOrders,
  quotes,
  salesOrders,
  shipments,
  vendorBills,
  vendors,
  workOrderOperations,
  workOrders,
  activities,
  orgs,
} from "@/lib/db/schema";
import type { Ctx } from "@/lib/tenancy";
import { can } from "@/lib/tenancy";
import { addDays, fmtDate, fmtMoney, fmtQty, today } from "@/lib/money";
import { shortageReport, latePoLines, createPurchaseOrder, receivePurchaseOrder, payBill, setPoStatus, PO_OPEN_STATUSES } from "@/modules/purchasing/service";
import { todaySummary } from "@/modules/reports/service";
import { onHand, stockByLocation } from "@/modules/inventory/service";
import { arAging, apAging, createInvoiceFromShipment, recordCustomerPayment, shipOrderInFull } from "@/modules/shipping/service";
import { acceptQuote, addOrderLine, confirmOrder, setQuoteStatus } from "@/modules/sales/service";
import { clockIn, createWorkOrder, releaseWorkOrder, scheduleBoard } from "@/modules/production/service";
import { balanceOfSubtype } from "@/modules/books/service";

/**
 * The assistant understands a fixed set of commands with plain-language
 * patterns, so it works with no external service. When an API key is set,
 * free text that matches nothing is sent to a language model that picks one
 * of the same commands; the model never acts on its own.
 */

export type Suggestion = { label: string; href?: string; text?: string };
export type AssistantResult =
  | { type: "navigate"; href: string; label: string }
  | { type: "answer"; title: string; lines?: string[]; rows?: { label: string; detail?: string; href?: string }[]; href?: string }
  | { type: "confirm"; title: string; summary: string[]; action: { command: string; args: Record<string, unknown> } }
  | { type: "done"; message: string; href?: string }
  | { type: "help"; message: string; suggestions: Suggestion[] };

export type PageContext = { pathname: string };

const SCREENS: [RegExp, string, string][] = [
  [/^(purchase orders?|pos?|purchasing)$/, "/purchasing", "Purchase orders"],
  [/^(receiving|receipts|receiving log)$/, "/purchasing/receipts", "Receiving log"],
  [/^(shortages?|what to buy|buy list)$/, "/purchasing/shortages", "What to buy"],
  [/^(sales orders?|orders?)$/, "/orders", "Sales orders"],
  [/^quotes?$/, "/quotes", "Quotes"],
  [/^customers?$/, "/customers", "Customers"],
  [/^vendors?|suppliers?$/, "/vendors", "Vendors"],
  [/^(items?|parts?|boms?|items? and boms?)$/, "/items", "Items"],
  [/^(inventory|stock)$/, "/inventory", "Inventory"],
  [/^(work orders?|wos?|jobs?)$/, "/work-orders", "Work orders"],
  [/^schedule$/, "/schedule", "Schedule"],
  [/^(shop floor|floor)$/, "/shop-floor", "Shop floor"],
  [/^shipments?$/, "/shipments", "Shipments"],
  [/^invoices?$/, "/invoices", "Invoices"],
  [/^(receive payment|payments?)$/, "/invoices/receive", "Receive payment"],
  [/^(bills?|vendor bills|payables)$/, "/bills", "Vendor bills"],
  [/^(ledger|books|journal|gl)$/, "/books", "Ledger"],
  [/^reports?$/, "/books/reports", "Reports"],
  [/^bank$/, "/books/bank", "Bank reconciliation"],
  [/^(recurring|templates)$/, "/books/recurring", "Recurring entries"],
  [/^budgets?$/, "/books/budgets", "Budgets"],
  [/^(chart|accounts|chart of accounts|periods)$/, "/books/accounts", "Chart of accounts"],
  [/^(quality|inspections?)$/, "/quality", "Inspections"],
  [/^(ncrs?|capas?)$/, "/quality/ncrs", "NCRs and CAPAs"],
  [/^gauges?$/, "/quality/gauges", "Gauges"],
  [/^(people|employees?)$/, "/people", "Employees"],
  [/^(maintenance|machines?)$/, "/maintenance", "Maintenance"],
  [/^documents?$/, "/documents", "Documents"],
  [/^import$/, "/import", "Import"],
  [/^settings$/, "/settings", "Settings"],
  [/^(today|home|dashboard)$/, "/", "Today"],
];

const NUMBER_RE = /\b(SO|PO|WO|INV|Q|SH|BILL|NCR|CAPA|CM|RC)-?(\d{3,6})\b/i;

function pad(n: string) {
  return n.padStart(5, "0");
}

async function findByNumber(db: DbOrTx, orgId: string, prefix: string, num: string): Promise<{ href: string; label: string; id: string; kind: string } | null> {
  const number = `${prefix.toUpperCase()}-${pad(num)}`;
  const q = async <T extends { id: string }>(table: { id: unknown; number: unknown; orgId: unknown }, href: string, kind: string) => {
    const rows = (await db.select().from(table as never).where(and(eq(table.orgId as never, orgId), eq(table.number as never, number))).limit(1)) as T[];
    return rows[0] ? { href: `${href}/${rows[0].id}`, label: number, id: rows[0].id, kind } : null;
  };
  switch (prefix.toUpperCase()) {
    case "SO":
      return q(salesOrders, "/orders", "order");
    case "PO":
      return q(purchaseOrders, "/purchasing", "po");
    case "WO":
      return q(workOrders, "/work-orders", "wo");
    case "INV":
    case "CM":
      return q(invoices, "/invoices", "invoice");
    case "Q":
      return q(quotes, "/quotes", "quote");
    case "SH":
      return q(shipments, "/shipments", "shipment");
    case "BILL":
      return q(vendorBills, "/bills", "bill");
    case "NCR":
    case "CAPA":
      return (await q(ncrs, "/quality/ncrs", "ncr")) ? { href: "/quality/ncrs", label: number, id: "", kind: "ncr" } : null;
    default:
      return null;
  }
}

/** The record behind the current page, so "this" and "it" resolve. */
async function pageRecord(db: DbOrTx, orgId: string, pathname: string) {
  const m = pathname.match(/^\/(orders|purchasing|work-orders|invoices|quotes|shipments|bills|customers|vendors|items)\/([0-9a-f-]{36})/);
  if (!m) return null;
  const [, section, id] = m;
  const map: Record<string, { table: { id: unknown; orgId: unknown; number?: unknown; name?: unknown; sku?: unknown }; kind: string }> = {
    orders: { table: salesOrders, kind: "order" },
    purchasing: { table: purchaseOrders, kind: "po" },
    "work-orders": { table: workOrders, kind: "wo" },
    invoices: { table: invoices, kind: "invoice" },
    quotes: { table: quotes, kind: "quote" },
    shipments: { table: shipments, kind: "shipment" },
    bills: { table: vendorBills, kind: "bill" },
    customers: { table: customers, kind: "customer" },
    vendors: { table: vendors, kind: "vendor" },
    items: { table: items, kind: "item" },
  };
  const t = map[section];
  const rows = (await db.select().from(t.table as never).where(and(eq(t.table.id as never, id), eq(t.table.orgId as never, orgId))).limit(1)) as Record<string, string>[];
  if (!rows[0]) return null;
  return { kind: t.kind, id, label: rows[0].number ?? rows[0].sku ?? rows[0].name ?? id, row: rows[0] };
}

const money = (n: number) => fmtMoney(n);

export async function interpret(db: DbOrTx, ctx: Ctx, rawText: string, page: PageContext): Promise<AssistantResult> {
  const text = rawText.trim().replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  const orgId = ctx.orgId;
  if (!text) return help();

  // --- "this" / "it": the record on the current page.
  const here = await pageRecord(db, orgId, page.pathname);

  // --- Navigation to a screen.
  const nav = lower.match(/^(?:go to|open|show|show me|take me to|goto)\s+(?:the\s+)?(.+)$/) ?? (SCREENS.some(([re]) => re.test(lower)) ? [null, lower] : null);
  if (nav) {
    const target = nav[1].replace(/\s+(page|screen|list)$/, "");
    const screen = SCREENS.find(([re]) => re.test(target));
    if (screen) return { type: "navigate", href: screen[1], label: screen[2] };
  }

  // --- Document numbers anywhere in the text: "open SO-00057", "SO 57".
  const numMatch = text.match(NUMBER_RE);
  const doc = numMatch ? await findByNumber(db, orgId, numMatch[1], numMatch[2]) : null;
  const target = doc ?? (/(this|it|here|current)\b/.test(lower) && here ? { href: page.pathname, label: here.label, id: here.id, kind: here.kind } : null);

  // --- Actions on a document.
  if (target) {
    if (/^(receive|receive all|receive in full|receive this|receive it)\b/.test(lower) && target.kind === "po") {
      return receiveConfirm(db, ctx, target.id);
    }
    if (/^(ship|ship in full|ship this|ship it|ship everything)\b/.test(lower) && target.kind === "order") {
      return shipConfirm(db, ctx, target.id, /\b(no invoice|without invoic)/.test(lower) ? false : true);
    }
    if (/^(invoice|bill the customer)\b/.test(lower) && target.kind === "shipment") {
      const [sh] = await db.select().from(shipments).where(eq(shipments.id, target.id));
      if (!sh) return help("Shipment not found.");
      if (sh.invoiceId) return { type: "navigate", href: `/invoices/${sh.invoiceId}`, label: "Already invoiced; opening the invoice" };
      return { type: "confirm", title: `Invoice ${target.label}`, summary: ["Creates the invoice at order prices with the default tax rate", "Posts receivables and revenue"], action: { command: "invoice_shipment", args: { shipmentId: target.id } } };
    }
    if (/^(confirm)\b/.test(lower) && target.kind === "order") {
      return { type: "confirm", title: `Confirm ${target.label}`, summary: ["Moves the order from draft to confirmed", "Credit checks apply"], action: { command: "confirm_order", args: { orderId: target.id } } };
    }
    if (/^(release)\b/.test(lower) && target.kind === "wo") {
      return { type: "confirm", title: `Release ${target.label}`, summary: ["Puts the work order on the floor and the schedule"], action: { command: "release_wo", args: { workOrderId: target.id } } };
    }
    if (/^(close|close short)\b/.test(lower) && target.kind === "po") {
      return { type: "confirm", title: `Close ${target.label} short`, summary: ["Cancels whatever has not been received", "The PO stops counting as on order"], action: { command: "close_po", args: { poId: target.id, reason: text.replace(NUMBER_RE, "").replace(/^(close short|close)\s*/i, "").trim() || "Closed from assistant" } } };
    }
    if (/^(pay)\b/.test(lower) && target.kind === "bill") {
      const [b] = await db.select().from(vendorBills).where(eq(vendorBills.id, target.id));
      if (!b) return help("Bill not found.");
      const open = Number(b.total) - Number(b.amountPaid);
      const amt = parseMoney(lower) ?? open;
      return { type: "confirm", title: `Pay ${target.label}`, summary: [`${money(amt)} of ${money(open)} open`, "Posts cash and payables, dated today"], action: { command: "pay_bill", args: { billId: target.id, amount: amt } } };
    }
    if (/^(record|log|take)?\s*(a\s+)?payment\b|^pay(ment)?\b|^paid\b/.test(lower) && target.kind === "invoice") {
      const [inv] = await db.select().from(invoices).where(eq(invoices.id, target.id));
      if (!inv) return help("Invoice not found.");
      const open = Number(inv.total) - Number(inv.amountPaid);
      const amt = parseMoney(lower) ?? open;
      return { type: "confirm", title: `Payment on ${target.label}`, summary: [`${money(amt)} of ${money(open)} open`, "Posts cash and receivables, dated today"], action: { command: "customer_payment", args: { invoiceId: target.id, amount: amt } } };
    }
    if (/^(mark|set)\b.*\b(sent)\b/.test(lower) && target.kind === "quote") return { type: "confirm", title: `Mark ${target.label} sent`, summary: ["Quote status becomes sent"], action: { command: "quote_status", args: { quoteId: target.id, status: "sent" } } };
    if (/\b(won|accept(ed)?)\b/.test(lower) && target.kind === "quote") return { type: "confirm", title: `Accept ${target.label}`, summary: ["Creates the sales order from the quote lines"], action: { command: "accept_quote", args: { quoteId: target.id } } };
    if (/\b(lost)\b/.test(lower) && target.kind === "quote") return { type: "confirm", title: `Mark ${target.label} lost`, summary: ["Quote status becomes lost"], action: { command: "quote_status", args: { quoteId: target.id, status: "lost", reason: text.replace(NUMBER_RE, "").replace(/.*lost:?\s*/i, "").trim() } } };
    if (/^(add)\b/.test(lower) && target.kind === "order") {
      const m = lower.match(/add\s+(\d+(?:\.\d+)?)?\s*(?:x\s*)?([a-z0-9][a-z0-9\-_.]+)\s*(?:qty\s*(\d+(?:\.\d+)?))?/);
      const sku = m?.[2];
      const qty = Number(m?.[1] ?? m?.[3] ?? 1);
      const it = sku ? await findItem(db, orgId, sku) : null;
      if (!it) return help(`Which item? Try "add 5 SA-BRACKET-L to ${target.label}".`);
      return { type: "confirm", title: `Add ${fmtQty(qty)} × ${it.sku} to ${target.label}`, summary: ["Price from the customer's price list", "Logged in the order's change log"], action: { command: "add_order_line", args: { orderId: target.id, itemId: it.id, qty } } };
    }
    if (/^(mark|set)\b.*\bsent\b/.test(lower) && target.kind === "po") return { type: "confirm", title: `Mark ${target.label} sent`, summary: ["PO status becomes sent"], action: { command: "po_status", args: { poId: target.id, status: "sent" } } };
    // Plain number: just open it.
    if (doc && !/^(create|make|new|clock)/.test(lower)) return { type: "navigate", href: doc.href, label: `Open ${doc.label}` };
  }

  // --- Clock in: "clock in Pat on WO-00050" / "clock Pat in on WO-00050 op 20".
  const clock = lower.match(/^clock\s+(?:in\s+)?([a-z][a-z .'-]+?)\s+(?:in\s+)?on\s+(wo-?\d+)(?:\s+op\s*(\d+))?/);
  if (clock) {
    const emp = await findEmployee(db, orgId, clock[1]);
    const wo = await findByNumber(db, orgId, "WO", clock[2].replace(/\D/g, ""));
    if (!emp) return help(`No employee called "${clock[1]}".`);
    if (!wo) return help(`No work order ${clock[2].toUpperCase()}.`);
    const ops = await db.select().from(workOrderOperations).where(eq(workOrderOperations.workOrderId, wo.id)).orderBy(asc(workOrderOperations.seq));
    const op = clock[3] ? ops.find((o) => o.seq === Number(clock[3])) : ops.find((o) => o.status !== "complete");
    if (!op) return help("No open operation on that work order.");
    return { type: "confirm", title: `Clock ${emp.name} in on ${wo.label} op ${op.seq}`, summary: [op.name, "Starts a labour entry now"], action: { command: "clock_in", args: { operationId: op.id, employeeId: emp.id } } };
  }

  // --- Create work order: "make 10 KIT-ROBOT-ARM" / "work order for KIT-X qty 5 due 2026-12-01".
  const mk = lower.match(/^(?:make|build|create (?:a )?work order for|work order for|wo for)\s+(\d+(?:\.\d+)?)?\s*(?:x\s*)?([a-z0-9][a-z0-9\-_.]+)(?:\s+(?:qty|x)\s*(\d+(?:\.\d+)?))?(?:.*?due\s+(\d{4}-\d{2}-\d{2}))?/);
  if (mk) {
    const it = await findItem(db, orgId, mk[2]);
    if (!it) return help(`No item "${mk[2].toUpperCase()}".`);
    const qty = Number(mk[1] ?? mk[3] ?? 1);
    return { type: "confirm", title: `Work order for ${fmtQty(qty)} × ${it.sku}`, summary: [it.name, mk[4] ? `Due ${fmtDate(mk[4])}` : "Due date from the item lead time", "Explodes the BOM and copies the routing"], action: { command: "create_wo", args: { itemId: it.id, qty, dueDate: mk[4] ?? null } } };
  }

  // --- POs from shortages: "create pos for shortages" / "order shortages from allied".
  if (/^(create|raise|make|order)\b.*\b(shortages?|what to buy|buy list)\b/.test(lower) || /^order (all )?shortages/.test(lower)) {
    const vendorName = lower.match(/\bfrom\s+(.+)$/)?.[1];
    const report = await shortageReport(db, orgId);
    let rows = report.filter((r) => r.preferredVendorId);
    let vendor: { id: string; name: string } | null = null;
    if (vendorName) {
      vendor = await findVendor(db, orgId, vendorName);
      if (!vendor) return help(`No vendor like "${vendorName}".`);
      rows = rows.filter((r) => r.preferredVendorId === vendor!.id);
    }
    if (!rows.length) return { type: "answer", title: "Nothing to order", lines: [report.length ? `${report.length} short items have no preferred vendor; set one on the item or the vendor's price list.` : "Stock and open POs cover every reorder point."], href: "/purchasing/shortages" };
    const byVendor = new Map<string, typeof rows>();
    for (const r of rows) byVendor.set(r.preferredVendorId!, [...(byVendor.get(r.preferredVendorId!) ?? []), r]);
    const vnames = await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(inArray(vendors.id, [...byVendor.keys()]));
    const summary = [...byVendor.entries()].map(([vid, rs]) => `${vnames.find((v) => v.id === vid)?.name}: ${rs.map((r) => `${fmtQty(r.suggestedQty)} × ${r.sku}`).join(", ")} (${money(rs.reduce((s, r) => s + r.suggestedQty * r.lastCost, 0))})`);
    return { type: "confirm", title: `Create ${byVendor.size} purchase order${byVendor.size > 1 ? "s" : ""}`, summary, action: { command: "pos_from_shortages", args: { itemIds: rows.map((r) => r.itemId) } } };
  }

  // --- Note on a party: "note on helix: called about delivery" / "follow up with helix tomorrow: ...".
  const note = text.match(/^(?:note on|log (?:a )?note on|note for|follow[- ]?up (?:with|on))\s+(.+?)(?:\s+(today|tomorrow|next week|on \d{4}-\d{2}-\d{2}))?\s*:\s*(.+)$/i);
  if (note) {
    const party = await findParty(db, orgId, note[1]);
    if (!party) return help(`No customer, vendor or lead like "${note[1]}".`);
    const when = note[2]?.toLowerCase();
    const due = when === "today" ? today() : when === "tomorrow" ? addDays(today(), 1) : when === "next week" ? addDays(today(), 7) : when?.startsWith("on ") ? when.slice(3) : null;
    return { type: "confirm", title: `${due ? "Follow-up" : "Note"} on ${party.name}`, summary: [note[3], due ? `Due ${fmtDate(due)}` : "Logged now"], action: { command: "add_note", args: { partyType: party.type, partyId: party.id, summary: note[3], dueAt: due } } };
  }

  // --- Downtime: "log downtime on haas: spindle fault".
  const dt = text.match(/^(?:log |record )?(?:downtime|machine down|down)\s+(?:on|for)\s+(.+?)\s*:\s*(.+)$/i);
  if (dt) {
    const [a] = await db.select().from(assets).where(and(eq(assets.orgId, orgId), ilike(assets.name, `%${dt[1]}%`))).limit(1);
    if (!a) return help(`No machine like "${dt[1]}".`);
    return { type: "confirm", title: `Log downtime on ${a.name}`, summary: [dt[2], "Marks the machine down; use Maintenance to bring it back up"], action: { command: "downtime", args: { assetId: a.id, reason: dt[2] } } };
  }

  // --- Lookups.
  if (/^(late orders?|what('s| is) late|overdue orders?)$/.test(lower)) {
    const s = await todaySummary(db, orgId);
    return { type: "answer", title: `${s.late.length} late order${s.late.length === 1 ? "" : "s"}`, rows: s.late.slice(0, 12).map((o) => ({ label: o.number, detail: `${o.customerName} · promised ${fmtDate(o.promisedDate)} · ${money(Number(o.subtotal))}`, href: `/orders/${o.id}` })), href: "/orders" };
  }
  if (/^(shortages?|what to buy|what do we need to buy|what('s| is) short)$/.test(lower)) {
    const r = await shortageReport(db, orgId);
    return { type: "answer", title: `${r.length} item${r.length === 1 ? "" : "s"} to buy`, rows: r.slice(0, 12).map((x) => ({ label: x.sku, detail: `${x.name} · on hand ${fmtQty(x.onHand)}, demand ${fmtQty(x.demand)}, on order ${fmtQty(x.onOrder)} · buy ${fmtQty(x.suggestedQty)}`, href: `/items/${x.itemId}` })), href: "/purchasing/shortages" };
  }
  const stockQ = lower.match(/^(?:stock|on hand|how many|how much|qty|quantity)(?:\s+(?:of|for|do we have of|is there of))?\s+(?:do we have\s+)?(?:of\s+)?([a-z0-9][a-z0-9\-_. ]+?)(?:\s+(?:do we have|in stock|on hand))?\??$/);
  if (stockQ) {
    const it = await findItem(db, orgId, stockQ[1]);
    if (!it) return help(`No item like "${stockQ[1]}".`);
    const [total, byLoc] = await Promise.all([onHand(db, orgId, it.id), stockByLocation(db, orgId, it.id)]);
    return { type: "answer", title: `${it.sku}: ${fmtQty(total)} ${it.uom} on hand`, lines: [it.name, ...byLoc.map((l) => `${l.code}${l.lotNumber ? ` lot ${l.lotNumber}` : ""}: ${fmtQty(l.onHand)}`), `Average cost ${money(Number(it.avgCost))}`], href: `/items/${it.id}` };
  }
  if (/^(open pos?|open purchase orders?|what('s| is) on order)(\s+(?:from|for|with)\s+(.+))?$/.test(lower)) {
    const vn = lower.match(/(?:from|for|with)\s+(.+)$/)?.[1];
    const vendor = vn ? await findVendor(db, orgId, vn) : null;
    if (vn && !vendor) return help(`No vendor like "${vn}".`);
    const rows = await db
      .select({ po: purchaseOrders, vendorName: vendors.name })
      .from(purchaseOrders)
      .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
      .where(and(eq(purchaseOrders.orgId, orgId), inArray(purchaseOrders.status, [...PO_OPEN_STATUSES]), vendor ? eq(purchaseOrders.vendorId, vendor.id) : undefined))
      .orderBy(asc(purchaseOrders.expectedDate));
    return { type: "answer", title: `${rows.length} open PO${rows.length === 1 ? "" : "s"}${vendor ? ` from ${vendor.name}` : ""}`, rows: rows.slice(0, 12).map((r) => ({ label: r.po.number, detail: `${r.vendorName} · expected ${fmtDate(r.po.expectedDate)} · ${r.po.status.replaceAll("_", " ")} · ${money(Number(r.po.subtotal))}`, href: `/purchasing/${r.po.id}` })), href: vendor ? `/purchasing?vendorId=${vendor.id}&status=open` : "/purchasing?status=open" };
  }
  if (/^(late (pos|purchase orders|deliveries|from vendors)|what('s| is) late from vendors)$/.test(lower)) {
    const rows = await latePoLines(db, orgId, today());
    return { type: "answer", title: `${rows.length} late PO line${rows.length === 1 ? "" : "s"}`, rows: rows.slice(0, 12).map((r) => ({ label: r.po.number, detail: `${r.vendorName} · ${r.sku ?? r.line.description} · ${fmtQty(Number(r.line.qty) - Number(r.line.qtyReceived) - Number(r.line.qtyCancelled))} open · needed ${fmtDate(r.line.expectedDate) || "no date"}`, href: `/purchasing/${r.po.id}` })), href: "/purchasing?status=open" };
  }
  if (/^(overdue invoices?|who owes us|receivables|ar|what('s| is) overdue|aging)$/.test(lower)) {
    const a = await arAging(db, orgId);
    const b = a.buckets;
    return { type: "answer", title: `${money(b.total)} open receivables`, lines: [`Current ${money(b.current)} · 1–30 ${money(b.d1_30)} · 31–60 ${money(b.d31_60)} · 61–90 ${money(b.d61_90)} · over 90 ${money(b.over90)}`], rows: a.rows.filter((r) => r.dueDate < today()).slice(0, 10).map((r) => ({ label: r.number, detail: `${r.customerName} · due ${fmtDate(r.dueDate)} · ${money(r.open)}`, href: `/invoices/${r.id}` })), href: "/invoices?status=issued" };
  }
  if (/^(bills due|what do we owe|payables|ap)$/.test(lower)) {
    const a = await apAging(db, orgId);
    return { type: "answer", title: `${money(a.buckets.total)} open payables`, rows: a.rows.slice(0, 10).map((r) => ({ label: r.number, detail: `${r.vendorName} · due ${fmtDate(r.dueDate)} · ${money(r.open)}`, href: `/bills/${r.id}` })), href: "/bills" };
  }
  if (/^(cash|how much cash|cash balance|bank balance)$/.test(lower)) {
    const c = await balanceOfSubtype(db, orgId, "cash");
    return { type: "answer", title: `Cash per the ledger: ${money(c)}`, href: "/books/reports" };
  }
  if (/^(summary|today|how are we doing|status)$/.test(lower)) {
    const s = await todaySummary(db, orgId);
    return { type: "answer", title: `Today, ${fmtDate(s.date)}`, lines: [`${s.late.length} late orders, ${s.dueThisWeek.length} due this week, backlog ${money(s.backlog)}`, `${s.shortages.length} items short, ${s.clockedIn} people clocked in`, `Cash ${money(s.cash)} · receivables ${money(s.arOpen)} (${money(s.arOverdue)} overdue) · payables ${money(s.apOpen)}`, `On-time delivery ${s.otd.pct === null ? "—" : `${s.otd.pct.toFixed(0)}%`}`], href: "/" };
  }
  if (/^(schedule|load|what('s| is) on the schedule)(\s+(?:for|at|on)\s+(.+))?$/.test(lower)) {
    const wcName = lower.match(/(?:for|at|on)\s+(.+)$/)?.[1];
    const board = await scheduleBoard(db, orgId);
    const sel = wcName ? board.filter((b) => b.workCenter.name.toLowerCase().includes(wcName) || b.workCenter.code.toLowerCase().includes(wcName)) : board;
    if (!sel.length) return help(`No work center like "${wcName}".`);
    return { type: "answer", title: "Schedule", rows: sel.map((b) => ({ label: b.workCenter.name, detail: `${b.operations.length} operations · ${fmtQty(b.loadHours)} h · ${b.daysOfWork.toFixed(1)} days of work` })), href: "/schedule" };
  }
  if (/^(gauges? due|calibration due|what needs calibrat)/.test(lower)) {
    const rows = await db.select().from(gauges).where(and(eq(gauges.orgId, orgId), sql`${gauges.nextDueAt} <= ${addDays(today(), 30)}`)).orderBy(asc(gauges.nextDueAt));
    return { type: "answer", title: `${rows.length} gauge${rows.length === 1 ? "" : "s"} due within 30 days`, rows: rows.map((g) => ({ label: g.name, detail: `${g.serial ?? ""} · due ${fmtDate(g.nextDueAt)}` })), href: "/quality/gauges" };
  }
  if (/^(pm due|maintenance due|what maintenance is due|pms? due)$/.test(lower)) {
    const rows = await db.select({ t: maintenanceTasks, asset: assets.name }).from(maintenanceTasks).innerJoin(assets, eq(assets.id, maintenanceTasks.assetId)).where(and(eq(maintenanceTasks.orgId, orgId), sql`${maintenanceTasks.nextDueAt} <= ${addDays(today(), 14)}`)).orderBy(asc(maintenanceTasks.nextDueAt));
    return { type: "answer", title: `${rows.length} maintenance task${rows.length === 1 ? "" : "s"} due within 14 days`, rows: rows.map((r) => ({ label: r.asset, detail: `${r.t.name} · due ${fmtDate(r.t.nextDueAt)}` })), href: "/maintenance" };
  }
  if (/^(open ncrs?|ncrs? open|quality issues)$/.test(lower)) {
    const rows = await db.select().from(ncrs).where(and(eq(ncrs.orgId, orgId), eq(ncrs.status, "open"))).orderBy(desc(ncrs.createdAt));
    return { type: "answer", title: `${rows.length} open NCR${rows.length === 1 ? "" : "s"}`, rows: rows.slice(0, 10).map((n) => ({ label: n.number, detail: `${n.source} · ${n.description.slice(0, 80)}` })), href: "/quality/ncrs" };
  }
  if (/^(who('s| is) clocked in|who is working|on the floor)$/.test(lower)) {
    const rows = await db.select({ emp: employees.name, op: workOrderOperations.name, wo: workOrders.number, since: laborEntries.startedAt }).from(laborEntries).innerJoin(employees, eq(employees.id, laborEntries.employeeId)).innerJoin(workOrderOperations, eq(workOrderOperations.id, laborEntries.workOrderOperationId)).innerJoin(workOrders, eq(workOrders.id, workOrderOperations.workOrderId)).where(and(eq(laborEntries.orgId, orgId), sql`${laborEntries.endedAt} is null`));
    return { type: "answer", title: `${rows.length} clocked in`, rows: rows.map((r) => ({ label: r.emp, detail: `${r.wo} · ${r.op} · since ${new Date(r.since).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` })), href: "/shop-floor" };
  }

  // --- Find a customer / vendor / item by name.
  const find = lower.match(/^(?:find|search|lookup|look up|customer|vendor|supplier|item|part|sku)\s+(.+)$/);
  if (find) {
    const needle = find[1];
    const [cs, vs, is] = await Promise.all([
      db.select({ id: customers.id, name: customers.name, code: customers.code }).from(customers).where(and(eq(customers.orgId, orgId), or(ilike(customers.name, `%${needle}%`), ilike(customers.code, `%${needle}%`)))).limit(5),
      db.select({ id: vendors.id, name: vendors.name, code: vendors.code }).from(vendors).where(and(eq(vendors.orgId, orgId), or(ilike(vendors.name, `%${needle}%`), ilike(vendors.code, `%${needle}%`)))).limit(5),
      db.select({ id: items.id, name: items.name, sku: items.sku }).from(items).where(and(eq(items.orgId, orgId), or(ilike(items.name, `%${needle}%`), ilike(items.sku, `%${needle}%`)))).limit(5),
    ]);
    const rows = [...cs.map((c) => ({ label: c.name, detail: `customer ${c.code}`, href: `/customers/${c.id}` })), ...vs.map((v) => ({ label: v.name, detail: `vendor ${v.code}`, href: `/vendors/${v.id}` })), ...is.map((i) => ({ label: i.sku, detail: i.name, href: `/items/${i.id}` }))];
    if (rows.length === 1) return { type: "navigate", href: rows[0].href, label: rows[0].label };
    if (rows.length) return { type: "answer", title: `${rows.length} matches for "${needle}"`, rows };
    return help(`Nothing matches "${needle}".`);
  }

  // Bare name of a customer/vendor/item (e.g. "helix", "sa-bracket-l").
  const bare = await findAny(db, orgId, lower);
  if (bare) return { type: "navigate", href: bare.href, label: bare.label };

  // --- Language model fallback, when configured.
  const llm = await llmInterpret(text, page, here);
  if (llm) return interpret(db, ctx, llm, page);
  return help(`I didn't understand "${text}".`);
}

function parseMoney(s: string): number | null {
  const m = s.match(/\$?\s*(\d[\d,]*(?:\.\d+)?)/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

async function findItem(db: DbOrTx, orgId: string, needle: string) {
  const n = needle.trim();
  const [exact] = await db.select().from(items).where(and(eq(items.orgId, orgId), ilike(items.sku, n))).limit(1);
  if (exact) return exact;
  const [like] = await db.select().from(items).where(and(eq(items.orgId, orgId), or(ilike(items.sku, `%${n}%`), ilike(items.name, `%${n}%`)))).orderBy(asc(items.sku)).limit(1);
  return like ?? null;
}
async function findVendor(db: DbOrTx, orgId: string, needle: string) {
  const [v] = await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(and(eq(vendors.orgId, orgId), or(ilike(vendors.name, `%${needle.trim()}%`), ilike(vendors.code, `%${needle.trim()}%`)))).limit(1);
  return v ?? null;
}
async function findEmployee(db: DbOrTx, orgId: string, needle: string) {
  const n = needle.trim();
  const [e] = await db.select().from(employees).where(and(eq(employees.orgId, orgId), eq(employees.active, true), or(ilike(employees.name, `%${n}%`), ilike(employees.badge, n)))).limit(1);
  return e ?? null;
}
async function findParty(db: DbOrTx, orgId: string, needle: string): Promise<{ type: "customer" | "vendor" | "lead"; id: string; name: string } | null> {
  const n = `%${needle.trim()}%`;
  const [c] = await db.select({ id: customers.id, name: customers.name }).from(customers).where(and(eq(customers.orgId, orgId), ilike(customers.name, n))).limit(1);
  if (c) return { type: "customer", ...c };
  const [v] = await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(and(eq(vendors.orgId, orgId), ilike(vendors.name, n))).limit(1);
  if (v) return { type: "vendor", ...v };
  const { leads } = await import("@/lib/db/schema");
  const [l] = await db.select({ id: leads.id, name: leads.company }).from(leads).where(and(eq(leads.orgId, orgId), ilike(leads.company, n))).limit(1);
  return l ? { type: "lead", ...l } : null;
}
async function findAny(db: DbOrTx, orgId: string, needle: string) {
  if (needle.length < 3 || needle.includes(" ") && needle.split(" ").length > 4) return null;
  const n = `%${needle}%`;
  const [c] = await db.select({ id: customers.id, name: customers.name }).from(customers).where(and(eq(customers.orgId, orgId), ilike(customers.name, n))).limit(2);
  if (c) return { href: `/customers/${c.id}`, label: c.name };
  const [v] = await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(and(eq(vendors.orgId, orgId), ilike(vendors.name, n))).limit(2);
  if (v) return { href: `/vendors/${v.id}`, label: v.name };
  const [i] = await db.select({ id: items.id, sku: items.sku }).from(items).where(and(eq(items.orgId, orgId), ilike(items.sku, n))).limit(2);
  if (i) return { href: `/items/${i.id}`, label: i.sku };
  return null;
}

function help(message = "Try one of these."): AssistantResult {
  return {
    type: "help",
    message,
    suggestions: [
      { label: "Late orders", text: "late orders" },
      { label: "What to buy", text: "what to buy" },
      { label: "Stock of a part", text: "stock SA-BRACKET-L" },
      { label: "Who owes us", text: "who owes us" },
      { label: "Create POs for shortages", text: "create POs for shortages" },
      { label: "Make 10 of an item", text: "make 10 KIT-ROBOT-ARM" },
      { label: "Open a document", text: "SO-00057" },
      { label: "Follow-up on a customer", text: "follow up with Helix tomorrow: confirm delivery date" },
    ],
  };
}

async function receiveConfirm(db: DbOrTx, ctx: Ctx, poId: string): Promise<AssistantResult> {
  const [po] = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.orgId, ctx.orgId)));
  if (!po) return help("PO not found.");
  if (!(PO_OPEN_STATUSES as readonly string[]).includes(po.status)) return help(`${po.number} is ${po.status.replaceAll("_", " ")}.`);
  const { purchaseOrderLines } = await import("@/lib/db/schema");
  const lines = await db.select({ l: purchaseOrderLines, sku: items.sku }).from(purchaseOrderLines).leftJoin(items, eq(items.id, purchaseOrderLines.itemId)).where(eq(purchaseOrderLines.poId, po.id));
  const open = lines.filter(({ l }) => l.lineType === "item" && Number(l.qty) - Number(l.qtyReceived) - Number(l.qtyCancelled) > 0);
  if (!open.length) return help(`Nothing left to receive on ${po.number}.`);
  const [loc] = await db.select().from(locations).where(and(eq(locations.orgId, ctx.orgId), eq(locations.type, "stock"), eq(locations.active, true))).orderBy(asc(locations.code)).limit(1);
  if (!loc) return help("No stock location set up.");
  return {
    type: "confirm",
    title: `Receive ${po.number} in full`,
    summary: [...open.map(({ l, sku }) => `${fmtQty(Number(l.qty) - Number(l.qtyReceived) - Number(l.qtyCancelled))} × ${sku}`), `Into ${loc.code} at PO cost; posts inventory and accrued purchases`],
    action: { command: "receive_po", args: { poId: po.id, locationId: loc.id } },
  };
}

async function shipConfirm(db: DbOrTx, ctx: Ctx, orderId: string, invoice: boolean): Promise<AssistantResult> {
  const [o] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, orderId), eq(salesOrders.orgId, ctx.orgId)));
  if (!o) return help("Order not found.");
  const { salesOrderLines } = await import("@/lib/db/schema");
  const lines = await db.select({ l: salesOrderLines, sku: items.sku }).from(salesOrderLines).innerJoin(items, eq(items.id, salesOrderLines.itemId)).where(eq(salesOrderLines.orderId, o.id));
  const open = lines.filter(({ l }) => Number(l.qty) - Number(l.qtyShipped) - Number(l.qtyCancelled) > 0);
  if (!open.length) return help(`Nothing open to ship on ${o.number}.`);
  const [loc] = await db.select().from(locations).where(and(eq(locations.orgId, ctx.orgId), inArray(locations.type, ["stock", "shipping", "staging"]), eq(locations.active, true))).orderBy(asc(locations.code)).limit(1);
  if (!loc) return help("No stock location set up.");
  const short: string[] = [];
  for (const { l, sku } of open) {
    const have = await onHand(db, ctx.orgId, l.itemId);
    const need = Number(l.qty) - Number(l.qtyShipped) - Number(l.qtyCancelled);
    if (have < need) short.push(`${sku}: need ${fmtQty(need)}, have ${fmtQty(have)}`);
  }
  if (short.length) return { type: "answer", title: `${o.number} cannot ship in full`, lines: short, href: `/orders/${o.id}` };
  return {
    type: "confirm",
    title: `Ship ${o.number} in full${invoice ? " and invoice" : ""}`,
    summary: [...open.map(({ l, sku }) => `${fmtQty(Number(l.qty) - Number(l.qtyShipped) - Number(l.qtyCancelled))} × ${sku}`), `From ${loc.code}; stock leaves at average cost${invoice ? ", invoice at order prices" : ""}`],
    action: { command: "ship_order", args: { orderId: o.id, locationId: loc.id, invoice } },
  };
}

/** Run a confirmed action. Every branch goes through the same services the screens use. */
export async function execute(db: DbOrTx, ctx: Ctx, command: string, args: Record<string, unknown>): Promise<{ message: string; href?: string }> {
  const need = (cap: string) => {
    if (!can(ctx.role, cap)) throw new Error(`Your role cannot do this (${cap}).`);
  };
  const s = (k: string) => String(args[k] ?? "");
  const n = (k: string) => Number(args[k] ?? 0);
  switch (command) {
    case "receive_po": {
      need("inventory.edit");
      const { purchaseOrderLines } = await import("@/lib/db/schema");
      const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, s("poId")));
      const open = lines.filter((l) => l.lineType === "item" && Number(l.qty) - Number(l.qtyReceived) - Number(l.qtyCancelled) > 0);
      const r = await receivePurchaseOrder(db, ctx, { poId: s("poId"), lines: open.map((l) => ({ poLineId: l.id, qty: Number(l.qty) - Number(l.qtyReceived) - Number(l.qtyCancelled), locationId: s("locationId") })) });
      return { message: `Received ${r.number}.`, href: `/purchasing/${s("poId")}` };
    }
    case "ship_order": {
      need("inventory.edit");
      const sh = await shipOrderInFull(db, ctx, s("orderId"), s("locationId"));
      if (args.invoice) {
        const [org] = await db.select({ settings: orgs.settings }).from(orgs).where(eq(orgs.id, ctx.orgId));
        const inv = await createInvoiceFromShipment(db, ctx, { shipmentId: sh.id, taxRatePct: org?.settings.defaultTaxRatePct ?? 0 });
        return { message: `Shipped ${sh.number} and invoiced ${inv.number}.`, href: `/invoices/${inv.id}` };
      }
      return { message: `Shipped ${sh.number}.`, href: `/shipments/${sh.id}` };
    }
    case "invoice_shipment": {
      need("sales.edit");
      const [org] = await db.select({ settings: orgs.settings }).from(orgs).where(eq(orgs.id, ctx.orgId));
      const inv = await createInvoiceFromShipment(db, ctx, { shipmentId: s("shipmentId"), taxRatePct: org?.settings.defaultTaxRatePct ?? 0 });
      return { message: `Invoiced ${inv.number}.`, href: `/invoices/${inv.id}` };
    }
    case "confirm_order":
      need("sales.edit");
      await confirmOrder(db, ctx, s("orderId"));
      return { message: "Order confirmed.", href: `/orders/${s("orderId")}` };
    case "release_wo":
      need("production.edit");
      await releaseWorkOrder(db, ctx, s("workOrderId"));
      return { message: "Work order released.", href: `/work-orders/${s("workOrderId")}` };
    case "close_po":
      need("purchasing.edit");
      await setPoStatus(db, ctx, s("poId"), "closed", { reason: s("reason") });
      return { message: "PO closed.", href: `/purchasing/${s("poId")}` };
    case "po_status":
      need("purchasing.edit");
      await setPoStatus(db, ctx, s("poId"), s("status") as "sent");
      return { message: `PO marked ${s("status")}.`, href: `/purchasing/${s("poId")}` };
    case "pay_bill": {
      need("books.edit");
      const p = await payBill(db, ctx, { billId: s("billId"), amount: n("amount"), paidAt: today() });
      return { message: `Payment ${p.number} recorded.`, href: `/bills/${s("billId")}` };
    }
    case "customer_payment": {
      need("books.edit");
      const p = await recordCustomerPayment(db, ctx, { invoiceId: s("invoiceId"), amount: n("amount"), paidAt: today() });
      return { message: `Payment ${p.number} recorded.`, href: `/invoices/${s("invoiceId")}` };
    }
    case "quote_status":
      need("sales.edit");
      await setQuoteStatus(db, ctx, s("quoteId"), s("status") as "sent" | "lost", s("reason") || undefined);
      return { message: `Quote marked ${s("status")}.`, href: `/quotes/${s("quoteId")}` };
    case "accept_quote": {
      need("sales.edit");
      const o = await acceptQuote(db, ctx, s("quoteId"));
      return { message: `Order ${o.number} created from the quote.`, href: `/orders/${o.id}` };
    }
    case "add_order_line": {
      need("sales.edit");
      await addOrderLine(db, ctx, s("orderId"), { itemId: s("itemId"), qty: n("qty") }, "added from assistant");
      return { message: "Line added.", href: `/orders/${s("orderId")}` };
    }
    case "clock_in": {
      need("shopfloor.clock");
      await clockIn(db, ctx, { operationId: s("operationId"), employeeId: s("employeeId") });
      return { message: "Clocked in.", href: "/shop-floor" };
    }
    case "create_wo": {
      need("production.edit");
      const wo = await createWorkOrder(db, ctx, { itemId: s("itemId"), qty: n("qty"), dueDate: args.dueDate ? s("dueDate") : null });
      return { message: `${wo.number} created.`, href: `/work-orders/${wo.id}` };
    }
    case "pos_from_shortages": {
      need("purchasing.edit");
      const ids = (args.itemIds as string[]) ?? [];
      const report = (await shortageReport(db, ctx.orgId)).filter((r) => ids.includes(r.itemId) && r.preferredVendorId);
      const byVendor = new Map<string, typeof report>();
      for (const r of report) byVendor.set(r.preferredVendorId!, [...(byVendor.get(r.preferredVendorId!) ?? []), r]);
      const made: { id: string; number: string }[] = [];
      for (const [vendorId, rows] of byVendor) {
        const po = await createPurchaseOrder(db, ctx, { vendorId, orderDate: today(), lines: rows.map((r) => ({ itemId: r.itemId, qty: r.suggestedQty, unitCost: r.lastCost })) });
        made.push({ id: po.id, number: po.number });
      }
      if (!made.length) return { message: "Nothing to order.", href: "/purchasing/shortages" };
      return { message: `Created ${made.map((m) => m.number).join(", ")}.`, href: made.length === 1 ? `/purchasing/${made[0].id}` : "/purchasing" };
    }
    case "add_note": {
      await db.insert(activities).values({ orgId: ctx.orgId, userId: ctx.userId, partyType: s("partyType") as "customer", partyId: s("partyId"), type: "note", summary: s("summary"), dueAt: args.dueAt ? new Date(`${s("dueAt")}T09:00:00`) : null, done: !args.dueAt });
      const href = s("partyType") === "customer" ? `/customers/${s("partyId")}` : s("partyType") === "vendor" ? `/vendors/${s("partyId")}` : `/crm/${s("partyId")}`;
      return { message: args.dueAt ? "Follow-up scheduled." : "Note logged.", href };
    }
    case "downtime": {
      need("maintenance.edit");
      await db.insert(downtimeLogs).values({ orgId: ctx.orgId, assetId: s("assetId"), reason: s("reason") });
      await db.update(assets).set({ status: "down", updatedAt: new Date() }).where(eq(assets.id, s("assetId")));
      return { message: "Downtime logged.", href: "/maintenance" };
    }
    default:
      throw new Error("Unknown command");
  }
}

/** Optional: let a language model rephrase free text into one of the known commands. */
async function llmInterpret(text: string, page: PageContext, here: { kind: string; label: string } | null): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: key });
    const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
    const res = await client.messages.create({
      model,
      max_tokens: 120,
      system: `You translate a user's request inside a small-factory ERP into ONE command line the app understands, or NONE.
Known command shapes (examples):
- go to <screen>  (screens: purchase orders, orders, quotes, customers, vendors, items, inventory, work orders, schedule, shop floor, shipments, invoices, bills, ledger, reports, bank, quality, ncrs, gauges, people, maintenance, settings)
- <document number> e.g. SO-00057, PO-00012, WO-00050, INV-00087, Q-00003, SH-00087, BILL-00012
- receive PO-00012 | ship SO-00057 | invoice SH-00087 | confirm SO-00057 | release WO-00050 | close short PO-00012 reason | pay BILL-00012 | payment 500 on INV-00087 | mark Q-00003 sent | Q-00003 won | Q-00003 lost: reason | add 5 SKU to SO-00057
- receive this | ship this | confirm this | release this (when the user is on that document's page)
- clock in <employee> on WO-00050 op 20 | make 10 SKU due 2026-12-01 | create POs for shortages from <vendor>
- late orders | what to buy | stock SKU | open POs from <vendor> | late deliveries | who owes us | bills due | cash | summary | schedule for <work center> | gauges due | pm due | open ncrs | who is clocked in
- note on <customer>: text | follow up with <customer> tomorrow: text | downtime on <machine>: reason | find <name>
Reply with the command line only, or NONE.`,
      messages: [{ role: "user", content: `Page: ${page.pathname}${here ? ` (${here.kind} ${here.label})` : ""}\nRequest: ${text}` }],
    });
    const out = res.content.find((c) => c.type === "text")?.text.trim() ?? "";
    if (!out || out === "NONE" || out.length > 200) return null;
    return out;
  } catch {
    return null;
  }
}

export const ASSISTANT_PLACEHOLDER = 'Try "late orders", "stock SA-BRACKET-L", "receive PO-00012", "make 10 KIT-ROBOT-ARM"…';
