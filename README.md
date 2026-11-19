# Kitwise

Quotes, sales orders, work orders, purchasing, inventory, shipping, invoicing, quality and the
books, in one application for small discrete manufacturers and kitting shops. Every stock
movement and every invoice, bill, payment, issue, completion and shipment posts a balanced journal
entry in the same database transaction, so the ledger always agrees with the floor.

Built for 5–50 person shops. One Next.js app, one Postgres database.

## Modules

| Area | Screens |
| --- | --- |
| Sell | Leads with follow-ups, customers with credit limits, price lists and ship-to addresses, quotes with cost build-up, discounts, terms and revisions, sales orders with requested/promised dates, holds, line and order discounts and a change log, acknowledgement print |
| Make | Items with multi-level BOMs and routings (cost roll-up), work orders, material issue, shop-floor clock in/out, schedule board by work center, printable traveler |
| Buy & stock | Vendors with price lists, purchase orders with revisions, non-stock lines, terms, ship-to, freight and tax, receiving with lots, locations and tolerance, receiving log, close short, shortage report → POs (safety stock, minimum order), inventory at weighted-average cost, counts/adjust/move |
| Ship & bill | Pack and ship with packages, weight and freight, pack list and certificate of conformance, invoices with discounts and freight, credit memos, void, payments across several invoices with unapplied credit, customer statements, vendor bills with three-way match, void and payment, AR/AP aging |
| Books | Chart of accounts, posting rules, periods with locks, journal, recurring entries, bank statement import and reconciliation, budgets vs actual, trial balance, P&L, balance sheet, cash flow, close checklist, sales tax and 1099 reports, job and customer margins, on-time delivery, journal export |
| Quality | Inspection plans and records, NCRs with dispositions, root cause, containment and cost, CAPAs with preventive actions and effectiveness checks, gauges with calibration history and certificates, vendor rating |
| People & machines | Employees with loaded rates, departments, shifts, training records and a skills matrix, machines with make, model, location and uptime, preventive maintenance, downtime log |
| Admin | Documents and drawings with revisions, roles (owner / office / shop / accountant / read-only), audit log, company settings and document text, spreadsheet import, CSV export of every list |
| Assistant | Ctrl/Cmd+K on any screen: open records by number, ask about late orders, stock, shortages, receivables or the schedule, and run common actions (receive a PO, ship and invoice, create POs for shortages, make an item, clock someone in) after a one-click confirmation. Works offline; an optional API key adds free-form phrasing. |

## Run it locally

```bash
npm install
npm run db:seed      # sample company with 120 orders in every state
npm run dev          # http://localhost:3000
```

Sign in as `owner@kitwise.demo` / `kitwise-demo` (also `office@` and `floor@`). No database to
install: without `DATABASE_URL` the app runs on an embedded Postgres in `./.data`. `npm run
db:reset` wipes it and reseeds.

## Put a demo online

Deploy to Vercel either from a terminal (`npm install`, then `npx vercel` and `npx vercel --prod`)
or by importing the GitHub repository at vercel.com with the default settings. Both give a
`.vercel.app` URL in a couple of minutes.

**Without a database (quick look).** On Vercel with no database configured the app runs in demo
mode: each server instance restores an in-memory copy of the sample company from
`data/demo.tar.gz`. Sign-in is a signed cookie, so it works on every instance, but instances do
not share memory: a record created on one may not show on the next page, and everything resets
on cold starts. Good for walking through the screens, not for trying a workflow end to end.
`KITWISE_DEMO=1` forces this mode anywhere; `KITWISE_DEMO=0` turns it off.

**With a free database (persistent, shared).** In the Vercel project open *Storage → Create
Database*, pick Neon or Supabase (free plans), connect it to the project (this sets `DATABASE_URL`
or `POSTGRES_URL`), add the environment variable `KITWISE_SEED=demo`, and redeploy. On first
start the app applies the migrations and loads the sample company (about 15 seconds), after which
every change persists and every visitor sees the same data. Remove `KITWISE_SEED` once you no
longer want the sample company created in an empty database.

`npm run demo:snapshot` rebuilds the demo-mode snapshot from the seed; the build refreshes it when
it is more than a few days old.

## Development

```bash
npm run check        # typecheck + lint + tests + build (what CI runs)
npm run db:generate  # after editing src/lib/db/schema
```

See `CONTRIBUTING.md` for the architecture, invariants and conventions, `docs/field-audit.md` for
what every screen holds and what is still missing, and `docs/` for the domain glossary and specs.

## Licence

Private. All rights reserved.
