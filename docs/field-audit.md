# Screen-by-screen audit

Every screen, what it holds, what the second build added, and what is still missing. "Fields" are what the record stores and the form edits; "Actions" are what a user can do from the screen. Items under "Not yet" are known gaps, not bugs.

## Everywhere

- Back link at the top of every screen below a list: the list it belongs to, or the record above an edit page. Lists and top-level screens have none; the sidebar is their navigation.
- Delete, folded away at the bottom of the side column, on quotes, sales orders, work orders and purchase orders that nothing has happened on (nothing received, shipped, invoiced, billed, issued or clocked). Anything further along is cancelled or closed so the paper trail stays; the audit log keeps the number and who deleted it. The assistant does the same with "delete this" after confirmation.
- Walkthrough (`/walkthrough`, also "New here?" on Today): one job from lead to cash on the sample company, each step with where to click, what to type and what changed in the books.

## Sell

### Customers (`/customers`, `/customers/[id]`, `/customers/[id]/edit`)
- Fields: code, name, email, phone, website, industry, sales rep, ship via, terms (days), credit limit, credit hold, standard discount %, tax exempt + certificate number, billing address, default shipping address, notes, active.
- Related: contacts, activity log with dated follow-ups, extra ship-to addresses (label, default flag), customer-specific price list (quantity breaks, validity dates), open receivables and overdue, invoiced this year, quotes, orders, invoices.
- Actions: new quote, new order, edit, add contact, log note or follow-up, add/remove address, add/remove price, print statement (from an invoice), CSV export of the list.
- Added this pass: website, industry, rep, ship via, credit limit/hold, discount, tax certificate, addresses, price list, follow-ups, overdue and YTD figures, search and export.
- Not yet: customer portal, consolidated invoicing, multiple contacts on a document, customer-specific part numbers.

### Leads (`/crm`, `/crm/[id]`)
- Fields: company, contact, email, phone, source, stage, estimated value, next action + date, expected close, lost reason, notes, owner.
- Actions: change stage (lost reason captured), convert to customer, campaigns, reactivation list of quiet customers with an email draft, log activity.
- Added: expected close, lost reason, dated follow-ups that surface on Today; "New quote" on a lead links the quote to the lead and reuses an existing customer with the same name instead of creating a duplicate; the lead moves to quoting, then won (quote accepted) or lost (quote lost, reason copied); the lead page lists its quotes.
- Not yet: email sending, pipeline forecast weighting, duplicate detection beyond an exact name match.

### Quotes (`/quotes`, `/quotes/new`, `/quotes/[id]`, `/quotes/[id]/edit`, print)
- Fields: customer, attention, RFQ number, quote date, valid until, quote discount %, revision, status, terms and conditions, notes; per line: item or custom description, qty, material/labour/outside/overhead cost, margin %, unit price (derived or typed), line discount %, lead time.
- Actions: create, edit (sent quotes get a new revision), mark sent, mark lost with reason, accept into a sales order (carries discounts and lead times), print, automatic expiry of sent quotes past their date, status filter, search, CSV export.
- Added: attention, terms, discounts, edit with revisions, expiry, filters, link to the lead it answers; the line editor applies quantity breaks from the price lists as the quantity changes (a typed price stays); delete for quotes that were not accepted.
- Not yet: quote-to-order line mapping for custom lines (create the item first), alternates/options on a quote, emailing from the app.

### Sales orders (`/orders`, `/orders/new`, `/orders/[id]`, `/orders/[id]/edit`, acknowledgement print)
- Fields: customer, customer PO, program, order date, requested date, promised date, terms, ship via, ship-to address, freight to invoice, order discount %, sales rep, notes, internal notes, hold reason; per line: item, description, qty, unit price (from the price list when blank), line discount %, promised date, notes, shipped/invoiced/cancelled quantities.
- Actions: confirm (credit hold and credit limit checks; owner override), edit while draft, logged header changes after confirmation, change a line (qty, price, discount, date) with a reason, add a line, cancel the open quantity of a line, cancel the order, create work orders, pack a shipment, ship in full and invoice, attachments, print acknowledgement with bill-to and ship-to, search and export.
- Added: requested date, terms, ship via, ship-to, freight, discounts, rep, internal notes, hold/credit logic, draft edit, header edit, add/cancel lines, attachments; the Work orders card shows each job's completion, operations done and due date with a progress bar; delete for orders nothing has happened on.
- Not yet: blanket orders with releases, backorder allocation rules, commissions, EDI.

## Make

### Items (`/items`, `/items/[id]`, `/items/[id]/edit`)
- Fields: SKU, name, description, type, unit of measure, status, standard/average/last cost, sales price, reorder point and quantity, safety stock, minimum order quantity, lead time, preferred vendor, default location, lot tracking, shelf life, weight, category, barcode, revision, drawing number.
- Related: BOM revisions with lines (component, qty per, scrap %, reference/position, notes), routing operations (sequence, work center, setup, run per unit, outside vendor and cost, instructions), cost roll-up, where used, stock by location and lot, vendors with part numbers and last costs, documents.
- Actions: add/remove BOM lines and operations, new BOM revision, recalculate cost, adjust/count, raise PO to the preferred vendor, export.
- Added: safety stock, min order, shelf life, weight, category, barcode, reference designators, vendor price card.
- Not yet: BOM alternates, effectivity dates on lines, engineering change orders, item images.

### Work orders (`/work-orders`, `/work-orders/[id]`, traveler print)
- Fields: item, quantity, priority, due date, scheduled start and end, status, notes, scrap reason, costs (material, labour, outside, overhead), link to the sales order line, BOM and routing used.
- Related: operations with planned and actual hours, materials with required/issued/on hand/short (short links to a PO), labour log, outside-processing POs, documents.
- Actions: release, issue one material or all, clock in/out and manual labour, complete with good/scrap and a scrap reason, cancel, planning edits (priority, dates, quantity while planned, notes), print traveler, search and export.
- Added: scheduled dates, quantity change while planned, scrap reasons, short column, search/export.
- Not yet: operation-level completion dates, rework orders, serial numbers, backflush.

### Schedule, shop floor
- Schedule: open operations per work center in priority then due order, load hours and days of work.
- Shop floor: pick a person, clock in on an operation, clock out with good/scrap, scrap reason, note and "operation finished".
- Not yet: finite scheduling, drag-and-drop sequencing, pause/resume, barcode scanning.

## Buy and stock

### Vendors (`/vendors`, `/vendors/[id]`, `/vendors/[id]/edit`)
- Fields: code, name, email, phone, website, terms, lead time, minimum order, our account number, payment method, ship via, tax ID, 1099 flag, address, notes, active, rating.
- Related: price list (item, vendor part number, last cost, lead time, minimum qty, preferred, last bought), POs, bills, open payables, on order, confirmation performance, open NCRs, contacts, activity.
- Actions: new PO, new bill, edit, add/remove price list rows (preferred sets the item's preferred vendor), search and export.
- Added: all fields after lead time, the price list, on-order figure, rating display.
- Not yet: vendor portal, RFQ to several vendors, vendor scorecard history.

### Purchase orders (`/purchasing`, `/purchasing/new`, `/purchasing/[id]`, `/purchasing/[id]/edit`, `/purchasing/receipts`, print)
- Fields: vendor, order date, expected date, vendor reference, terms, ship via, freight (expected), tax (expected), ship-to address (defaults to the company address), notes to vendor, internal notes, buyer, revision, sent/closed timestamps, cancel reason; per line: item or non-stock description, vendor part number, qty, unit cost (from the price list when blank), need-by date, notes, received/billed/cancelled quantities, expense account for service lines.
- Actions: create (optionally marked sent), edit (sent POs get a revision), mark sent, record vendor confirmation, receive with per-line quantity, lot and location and a received-on date (over-receipt tolerance from Settings), bill received goods plus service lines, freight and tax (several bills per PO), close short with a reason, cancel with a reason, email draft with copy and mail-to, print, attachments, receiving log, list filters and CSV export, "what to buy" that creates one PO per preferred vendor.
- Added: everything after "vendor reference" in fields; edit/revision, non-stock lines, close short, receiving log, email draft, attachments, filters/export, price-list costs, late-from-vendor list on Today.
- Not yet: return to vendor (debit memo), landed-cost allocation of freight into item cost, approval workflow above a threshold, blanket POs.

### Vendor bills (`/bills`, `/bills/[id]`, `/bills/new`)
- Fields: vendor, vendor reference, dates, subtotal, tax, freight, total, paid, status, notes; lines with PO line links.
- Actions: bill from a PO, expense bill to a chosen expense account, pay (partial allowed), void an unpaid bill (reverses the postings), three-way match indicator (ordered vs received vs billed, and PO cost), aging, export.
- Added: freight, void, match indicator, export.
- Not yet: one payment across several bills, vendor credits, early-payment discounts, check printing.

### Inventory (`/inventory`, `/inventory/adjust`, locations)
- On hand, average cost and value per item; ties to the ledger; movement history; counts, adjustments, moves, scrap; locations (stock, WIP, staging, shipping, quarantine).
- Added: safety stock and minimum order feed the shortage report; CSV export.
- Not yet: cycle-count schedules, bin-level locations, serial numbers, unit-of-measure conversions.

## Ship and bill

### Shipments (`/shipments`, `/shipments/new`, `/shipments/[id]`, pack list, certificate of conformance)
- Fields: order, customer, carrier, tracking, packages, weight, ship-to, freight charge, notes, status; lines with lot and location.
- Actions: pack with per-line location, ship now or save draft, update details after shipping, delete a draft, invoice the shipment, print pack list and certificate of conformance (items, revisions, lots, work orders and final inspections).
- Added: packages, weight, ship-to, freight, per-line location, details edit, draft delete, certificate.
- Not yet: carrier rate shopping and labels, multi-order shipments, BOL print.

### Invoices and payments (`/invoices`, `/invoices/[id]`, `/invoices/receive`, print, statement)
- Fields: customer, dates, terms, subtotal (goods less line and order discounts, plus freight), tax rate and tax, total, paid, status, kind (invoice or credit memo), memo.
- Actions: record a payment on one invoice, receive one payment across several invoices with the remainder held as unapplied credit, apply unapplied credit later, credit memo with optional restock to inventory, void an unpaid invoice (reopens the shipment for invoicing), print invoice and customer statement, aging, status filter, search, export.
- Added: discounts and freight on invoices, credit memos, void, multi-invoice payments and unapplied credit, statements, filters.
- Not yet: progress billing, recurring invoices, online payment links, dunning emails, finance charges.

## Books

### Ledger, chart, rules, periods
- Trial balance, journal with reversal, manual entries, chart of accounts, posting rules by event (missing rules fall back to the defaults and are stored), periods with locks.
- Not yet: account hierarchies, departments or classes, multi-currency.

### Recurring (`/books/recurring`) — new
- Templates with name, memo, frequency, next date and balanced lines; post on a date and the next date rolls forward; due templates appear on the close checklist.

### Bank (`/books/bank`) — new
- Import a statement CSV (date, description, amount or debit/credit, reference; duplicates skipped), automatic match to customer and vendor payments by amount within seven days, manual match from candidates, undo, post unmatched lines (fees, interest) to an account, summary of cash per books vs statement lines.
- Not yet: bank feeds, statement ending-balance reconciliation report, rules that auto-categorise recurring descriptions.

### Budgets (`/books/budgets`) — new
- Yearly amount spread over twelve months per revenue or expense account; budget vs actual YTD with variance and percentage.
- Not yet: monthly entry grid, department budgets, forecast.

### Reports (`/books/reports`)
- Profit and loss, balance sheet, receivables and payables aging, job and customer margins, on-time delivery, inventory value tie, cash flow (indirect, simplified), close checklist (unreconciled bank lines, received-not-billed, overdue AR/AP, open WIP, templates due), sales tax by month, 1099 vendor totals, journal CSV export for the accountant.
- Not yet: comparative periods, departmental P&L, fixed-asset depreciation schedules, QuickBooks sync.

## Quality

- Inspections: plans by stage with checklists, records with measurements, automatic NCR on failure, pass rate.
- NCRs: source, item, vendor, work order, qty, description, disposition, root cause, containment, cost, customer reference, close.
- CAPAs: root cause, corrective action, preventive action, owner, due date, effectiveness check date and result, verify/close.
- Gauges: name, serial, location, owner, interval, last/next calibration, status; calibration history with result (pass/fail/adjusted), certificate number, performed by, notes; overdue and due-soon counts.
- Added: NCR analysis fields, CAPA prevention and effectiveness, calibration history and gauge location/owner, certificate of conformance on shipments.
- Not yet: supplier corrective action requests sent by email, gauge R&R, document control with approvals, audit scheduling.

## People and machines

- Employees: name, badge, loaded rate, department, shift, hire date, email, phone, skills, active; training records (skill, trained on, expires, trainer, notes) that drive a skills matrix with expiry colouring; hours in the last seven days; edit in place.
- Machines: name, work center, serial, manufacturer, model, location, purchase date, status, 30-day uptime from downtime logs; preventive tasks with intervals and completion; downtime log with back-up.
- Added: department/shift/hire/contact, trainings and matrix, machine make/model/location, uptime.
- Not yet: time-off and attendance, payroll export file, meter-based maintenance, spare-parts lists per machine.

## Admin

- Settings: company name, currency, default terms, default tax, overhead %, default margin, over-receipt tolerance, company legal name/address/phone/email/website/tax ID (printed on documents, default ship-to), standard terms text for quotes, POs and invoices, invoice footer; people with access (add with a temporary password, change role, remove); your password; audit log.
- Documents: files with revisions attached to items, work orders, orders and POs.
- Import: CSV/Excel for customers, vendors, items, BOMs, work centers, stock counts and employees with column mapping and safe re-import.
- Assistant ("Ask", Ctrl/Cmd+K on every screen): navigation by screen name or document number, live answers (late orders, what to buy, stock of an item, open or late POs, who owes us, bills due, cash, summary, schedule, gauges due, maintenance due, open NCRs, who is clocked in), and actions that run only after confirmation (receive a PO, ship and invoice an order, invoice a shipment, confirm, release, close short, pay a bill, record a payment, quote sent/won/lost, add a line, clock someone in, make an item, create POs for shortages, notes and follow-ups, downtime). "This" refers to the record on screen. Works without any external service; with `ANTHROPIC_API_KEY` set, free-form phrasing is translated into the same commands.
- Not yet: email in/out, SSO, two-factor sign-in, row-level security in the database (tenancy is enforced in the application), scheduled jobs (recurring entries post when you click, quotes expire when the list is opened), a recycle bin (deletes are final; the audit log is the record).
