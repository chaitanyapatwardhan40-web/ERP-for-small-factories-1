# Kitwise

Quotes, sales orders, work orders, purchasing, inventory, shipping, invoicing, quality and the
books, in one application for small discrete manufacturers and kitting shops. Every stock
movement and every invoice, bill, payment, issue, completion and shipment posts a balanced journal
entry in the same database transaction, so the ledger always agrees with the floor.

Built for 5–50 person shops. One Next.js app, one Postgres database.

## Modules

| Area | Screens |
| --- | --- |
| Sell | Leads and quiet-customer list, customers, quotes with cost build-up and margin, sales orders with change log, order acknowledgement |
| Make | Items with multi-level BOMs and routings (cost roll-up), work orders, material issue, shop-floor clock in/out, schedule board by work center, printable traveler |
| Buy & stock | Vendors, purchase orders (including outside processing), receiving with lots, shortage report → POs, inventory at weighted-average cost, counts/adjust/move |
| Ship & bill | Pack and ship, pack list, invoices from shipments, customer payments, vendor bills from POs and expense bills, vendor payments, AR/AP aging |
| Books | Chart of accounts, posting rules, periods with locks, journal, trial balance, P&L, balance sheet, job and customer margins, on-time delivery |
| Quality | Inspection plans and records, NCRs with dispositions, CAPAs, gauges and calibration due dates, vendor rating |
| People & machines | Employees with loaded rates and skills, machines, preventive maintenance, downtime log |
| Admin | Documents and drawings with revisions, roles (owner / office / shop / accountant / read-only), audit log, settings, spreadsheet import |

## Run it locally

```bash
npm install
npm run db:seed      # sample company with 120 orders in every state
npm run dev          # http://localhost:3000
```

Sign in as `owner@kitwise.demo` / `kitwise-demo` (also `office@` and `floor@`). No database to
install: without `DATABASE_URL` the app runs on an embedded Postgres in `./.data`. `npm run
db:reset` wipes it and reseeds.

## Put a demo online (no database)

Demo mode runs the app on an in-memory copy of the sample company, rebuilt from
`data/demo.tar.gz` whenever the server starts. Nothing to provision.

```bash
npm install
npx vercel          # first run: sign in, accept the defaults → preview URL
npx vercel --prod   # production URL
```

Demo mode is on automatically on Vercel when `DATABASE_URL` is not set (`KITWISE_DEMO=1`
forces it anywhere, `KITWISE_DEMO=0` turns it off). Data lives in the memory of each server
instance, so changes persist for a while and reset on cold starts. `npm run demo:snapshot`
rebuilds the snapshot from the seed; the build does this automatically when the snapshot is more
than a few days old.

## Deploy for real

1. Create a Postgres database (Supabase, Neon, RDS or the Vercel Marketplace) and copy its
   connection string.
2. Set environment variables: `DATABASE_URL`; optionally `BLOB_READ_WRITE_TOKEN` (Vercel Blob
   for uploaded drawings; without it files are stored on local disk, which is fine for a server
   but not for serverless) and `ANTHROPIC_API_KEY` (column-mapping assistant in the import wizard).
3. Run the migrations once: `DATABASE_URL=... npm run db:migrate`.
4. Deploy (`npx vercel --prod`, or connect the repository to Vercel for previews on every branch).

Vercel functions run 300 s by default and 800 s on Pro; nothing in the app needs more.

## Development

```bash
npm run check        # typecheck + lint + tests + build (what CI runs)
npm run db:generate  # after editing src/lib/db/schema
```

See `CONTRIBUTING.md` for the architecture, invariants and conventions, and `docs/` for the
domain glossary and module specs.

## Licence

Private. All rights reserved.
