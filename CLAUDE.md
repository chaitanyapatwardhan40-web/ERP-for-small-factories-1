# Kitwise — the all-in-one system for small factories

Quote, make, buy, ship, bill, with the books posted from every event. One Next.js app, one Postgres,
built for 5–50 person discrete / kitting shops. The USP is the implementer: a shop's spreadsheets go
in and a configured system comes out (see `src/modules/importer`).

Read `docs/glossary.md` before touching domain code and `docs/specs/*.md` before changing a module.

## Stack

- Next.js 16 (App Router, classic rendering: `cacheComponents: false`, every ERP page is dynamic).
  Next 16 differs from training data: read `node_modules/next/dist/docs/` (proxy.ts instead of
  middleware.ts, `params`/`searchParams` are Promises, `cookies()` is async).
- TypeScript, Tailwind v4, hand-written UI primitives in `src/components/ui`.
- Drizzle ORM. PGlite (embedded Postgres) when `DATABASE_URL` is unset (dev, tests, demos);
  postgres-js against Supabase/Neon/any Postgres in production. Migrations in `drizzle/` are
  generated with `npm run db:generate` and applied automatically by PGlite, with
  `npm run db:migrate` on Postgres.
- Vitest for domain tests (each test file gets an in-memory PGlite). Playwright is not in the repo;
  verification walks live in the session that built it.

## Layout

```
src/app/(auth)        login, register, onboarding
src/app/(erp)         every business screen; layout.tsx calls requireOrg()
src/app/(erp)/print   printable documents (browser print-to-PDF; no headless Chrome on Vercel)
src/app/api           health, file streaming
src/components/ui     Button, fields, ActionForm/SubmitButton, PageHeader/Card/Badge/Stat/Tabs/DL
src/components/forms  shared form pieces (line editor, party forms, attachments, journal form)
src/lib               db (schema, factory, seed), auth, tenancy, numbering, audit, forms, money
src/modules/<m>       service.ts (domain logic, takes db/tx + actor), actions.ts ("use server"), tests
docs/                 glossary, module specs, posting rules
drizzle/              SQL migrations
```

## Rules that cannot be retrofitted

1. **Tenancy.** Every business table has `org_id`. Every query filters by it. Server actions and pages
   get it from `requireOrg()` (`src/lib/tenancy.ts`) and pass `{ orgId, userId }` into services.
   Never trust an id from a form without scoping the query by `orgId`.
2. **Append-only ledgers.** `inventory_transactions` and `journal_entries/journal_lines` are never
   updated or deleted. Mistakes are corrected with a reversing row (`reverseEntry`, opposite move).
3. **One transaction per business event.** A service that moves stock, touches a document and posts
   the ledger does it inside one `db.transaction`. Actions open the transaction; services accept
   `DbOrTx` and never open their own.
4. **Posting through rules only.** Money reaches the ledger through `postEvent(event, amount)` in
   `src/modules/books/service.ts`, which looks up `posting_rules` (event → debit/credit account
   *subtype*). Add a new event to `DEFAULT_RULES` in `chart.ts`; never hard-code an account.
5. **Documents are header + lines + status machine** (quote, order, PO, work order, shipment,
   invoice, bill) and link to the document they came from (`quoteId`, `salesOrderLineId`,
   `shipmentId`...). Status is derived from lines where possible (`recomputeOrderStatus`).
6. **Inventory cost is moving weighted average** (`moveStock`). Inbound movements with a cost update
   `items.avgCost`; outbound use it. Sum(qty × unitCost) of transactions equals the GL inventory
   account; `src/modules/flow.test.ts` proves it and must keep passing.
7. **Numbering** via `nextNumber(db, orgId, key)` (`src/lib/numbering.ts`); never compute numbers
   in the UI.
8. **Audit** meaningful writes with `audit(...)` (`src/lib/audit.ts`).

## Conventions

- Server actions: `"use server"`, signature `(prev: ActionState, formData: FormData)`, parse with
  Zod via `formObject`/`formLines` (`src/lib/forms.ts`), wrap in `withFormErrors`, `redirect()` on
  success when the form will unmount, else `revalidatePath` + `{ ok }`.
- Forms are uncontrolled; use `<ActionForm action={...}>` + `<SubmitButton>`. Repeating lines are
  named `lines[i][field]`.
- Pages are async server components: `requireOrg()` → queries → JSX. No database calls from client
  components. No AI calls from the browser.
- Money/qty columns are `numeric` with `mode: "number"` (see `schema/_shared.ts`); round with
  `round4`/`round2`; format with `fmtMoney`/`fmtQty`/`fmtDate`.
- Ids are UUIDs; detail pages call `uuidOr404(id)` before querying.
- Keep screens plain: tables with class `data`, cards, one primary action per card.
- Dates in `date` columns are `YYYY-MM-DD` strings (`today()`, `addDays()`).

## Commands

```
npm run dev          # http://localhost:3000, PGlite in ./.data
npm run db:seed      # demo shop (owner@kitwise.demo / kitwise-demo); db:reset wipes ./.data first
npm run test         # vitest: cost roll-up, quote-to-cash flow with books, importer
npm run typecheck && npm run lint && npm run build
npm run db:generate  # after editing src/lib/db/schema/*
npm run check        # everything CI runs
```

## Definition of done for a PR

Typecheck, lint, tests and build pass; a schema change ships with a migration; a new business event
has a posting rule, a service function, a test in `flow.test.ts` or a module test, and an audit
entry; any new detail page validates its id; the golden dataset (`src/lib/db/seed.ts`) still seeds.

## Never

- Edit a shipped migration (add a new one).
- Bypass `requireOrg()` or write a query without `org_id`.
- Post to the ledger outside `postEvent`/`postJournal`.
- Put `Date.now()`/`Math.random()` in render (lint fails); use `today()` helpers.
- Fetch Google Fonts or anything at build time (the build must work offline).

## Not yet (honest list)

Row-level security policies (tenancy is app-layer + tests), email in/out (Resend), bank feeds,
QuickBooks sync, EDI, carrier labels, customer/vendor portals, scheduling beyond the priority
queue, multi-currency, sales-tax services, payroll. See `docs/specs/roadmap.md`.
