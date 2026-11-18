# Module specs (v1 as built)

Each module: where it lives, its state machines, and the invariants a change must keep.

## Platform (`src/lib`, `src/modules/platform`)
Orgs, users, memberships with roles, sessions (random token, hashed in DB, 30-day cookie),
audit log, per-org numbering, units, attachments (local disk or Vercel Blob). Roles → capabilities in
`src/lib/tenancy.ts`. Onboarding creates the chart of accounts, posting rules, periods, four
locations, units and one work center.

## Items, BOMs, routings (`src/modules/items`)
BOM revisions (draft/active/obsolete); new revision copies lines and obsoletes the old one. Routing
operations with work center, setup hours, run hours per unit, optional outside vendor and cost.
`rollUpCost` recurses make items, applies scrap and the overhead policy; `explodeForWorkOrder`
flattens phantoms and merges duplicates. Where-used is a query.

## Sales (`src/modules/sales`)
Quote: draft → sent → accepted | lost | expired. Accepting creates the order (every line needs an
item). Order: draft → confirmed → in_production → partially_shipped → shipped → invoiced → closed,
or cancelled (not after shipping). Line changes after confirmation are logged in `order_changes`.
Status is recomputed from line quantities.

## Purchasing (`src/modules/purchasing`)
PO: draft → sent → confirmed → partially_received → received → closed, or cancelled (not after
receipt). Receipt lines create inventory receipts at PO cost (or WIP for outside processing). Bills
from a PO cover received-not-billed quantity; expense bills post to a chosen expense subtype.
Shortage report = demand (open WO materials + confirmed order lines for buy items) − stock − open
POs, topped up to reorder quantity; one PO per preferred vendor from the selection.

## Inventory (`src/modules/inventory`)
Append-only transactions; signed quantities; moving weighted average per item (org-wide); transfers
are two cost-neutral movements; on-hand per location/lot is a sum; negative stock is refused except
for explicit adjustments.

## Production (`src/modules/production`)
WO: planned → released → in_progress → complete → closed, or cancelled (only with no cost on it).
Materials exploded at creation; operations copied from the routing with planned hours × qty. Issue
posts WIP/inventory. Labour entries (clock in/out or manual) post WIP/labour absorbed at the employee's
loaded rate. Completion applies overhead, splits cost between good and scrapped units, moves good
units to stock at actual unit cost, and marks the sales order line's order status.

## Shipping and billing (`src/modules/shipping`)
Shipment: draft → shipped (stock out at average cost, COGS). Invoice from a shipment at order prices
(+ tax unless customer is exempt): issued → paid | void. Payments post cash/AR. Vendor payments post
AP/cash. AR/AP aging in 30-day buckets.

## Books (`src/modules/books`)
`postEvent` (two-line entries through rules), `postJournal` (manual, must balance), `reverseEntry`.
Periods lock posting. Reports are computed from journal lines: trial balance, P&L (date range),
balance sheet (as of, with current earnings), account activity with running balance.

## Quality, CRM, maintenance, people
Inspection plans (checklists) and records (pass/fail from measurements and rejected qty; failure can
open an NCR). NCR dispositions; vendor rating = 100 − 5 × open NCRs. CAPA open → verified → closed.
Gauges with calibration due dates. Leads pipeline with stages; converting creates a customer and
starts a quote. Reactivation radar from order history; campaigns record audience and a drafted
email (delivery when Resend is wired). Assets, PM tasks by interval, downtime log that marks the
machine down. Employees with loaded rate and skills; hours feed job cost.

## Importer (`src/modules/importer`)
Parse CSV/XLSX → find header row → guess entity → map columns (header heuristics; language model optional) →
user confirms → `runImport` upserts by code/SKU/name; opening stock posts `inventory.opening`.
Row errors are collected, never abort the batch.
