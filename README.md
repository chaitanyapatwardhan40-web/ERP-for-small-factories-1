# Kitwise

The all-in-one system for small factories: quote → make → buy → ship → bill, with the books posted
from every event, and an **implementer** that turns the spreadsheets a shop already runs on into a
configured system.

Built for 5–50 person discrete, make-to-order and kitting shops. One Next.js app, one Postgres.

## What is in the box

| Area | Screens |
| --- | --- |
| Sell | Leads and reactivation radar, customers, quotes with cost build-up and margin, sales orders with change log, order acknowledgement |
| Make | Items with multi-level BOMs and routings (cost roll-up), work orders, material issue, shop-floor clock in/out, schedule board by work center, printable traveler |
| Buy & stock | Vendors, purchase orders (incl. outside processing), receiving with lots, what-to-buy shortage report → POs, inventory with weighted-average cost, counts/adjust/move |
| Ship & bill | Pack and ship, pack list, invoices from shipments, customer payments, vendor bills from POs and expense bills, vendor payments, AR/AP aging |
| Books | Chart of accounts, posting rules, periods with locks, journal, trial balance, P&L, balance sheet, job and customer margins, on-time delivery |
| Quality | Inspection plans and records, NCRs with dispositions, CAPAs, gauges and calibration due dates, vendor rating |
| People & machines | Employees with loaded rates and skills, machines, preventive maintenance, downtime log |
| Platform | Documents and drawings with revisions, roles (owner / office / shop / accountant / readonly), audit log, settings, the import wizard |

Every stock movement and every invoice, bill, payment, issue, completion and shipment posts a balanced
journal entry in the same database transaction. Inventory value equals the inventory account to the cent;
`src/modules/flow.test.ts` proves it end to end.

## Run it

```bash
npm install
npm run db:seed      # demo shop with 120 orders in every state
npm run dev          # http://localhost:3000
```

Sign in as `owner@kitwise.demo` / `kitwise-demo` (also `office@` and `floor@`). No database to install:
without `DATABASE_URL` the app runs on an embedded Postgres (PGlite) in `./.data`. `npm run db:reset`
wipes it and reseeds.

## Deploy to Vercel

1. Create a Postgres database (Supabase, Neon or the Vercel Marketplace) and copy its connection string.
2. Push this repo to GitHub and import it in Vercel.
3. Set environment variables: `DATABASE_URL`, `SESSION_SECRET` (any long random string), optionally
   `ANTHROPIC_API_KEY` (lets the importer map columns with Claude) and `BLOB_READ_WRITE_TOKEN`
   (Vercel Blob for uploaded drawings; without it files are stored on local disk, which is fine for
   development but not for serverless).
4. Run the migrations once against the database: `DATABASE_URL=... npm run db:migrate`.
5. Deploy. Every PR gets a preview deployment; point previews at a branch database if you use Neon or
   Supabase branching.

Vercel functions run 300 s by default and 800 s on Pro; nothing in the app needs more. Long imports
and future MRP runs belong in Vercel Workflows or Inngest (see `docs/specs/roadmap.md`).

## Develop with Claude Code

`CLAUDE.md` holds the rules of the codebase and `docs/` the domain. The loop per feature: write or
update the spec in `docs/specs`, change the schema and generate a migration, write the service and
its test, then the action and the screen, then `npm run check`.

```bash
npm run check        # typecheck + lint + tests + build (what CI runs)
npm run db:generate  # after editing src/lib/db/schema
```

## Licence

Private. All rights reserved.
