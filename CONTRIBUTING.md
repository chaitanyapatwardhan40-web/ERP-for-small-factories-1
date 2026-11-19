# Contributing

Kitwise is one Next.js app and one Postgres database. Read `docs/glossary.md` before touching
domain code and the relevant `docs/specs/*.md` before changing a module.

## Stack

- Next.js 16, App Router, classic rendering (`cacheComponents: false`; every business page is
  dynamic). Request-time APIs are async: `params`, `searchParams`, `cookies()`. The request
  filter lives in `src/proxy.ts`.
- TypeScript, Tailwind v4, hand-written UI primitives in `src/components/ui`.
- Drizzle ORM. PGlite (embedded Postgres) when no database URL is set (development, tests, demo
  mode); postgres-js against any Postgres in production. Migrations in `drizzle/` are generated
  with `npm run db:generate` and applied on start-up under an advisory lock (`src/lib/db/index.ts`),
  or by hand with `npm run db:migrate`. `KITWISE_SEED=demo` loads the sample company into an
  empty database.
- Vitest for domain tests; each test file gets its own in-memory database.

## Layout

```
src/app/(auth)        login, register, onboarding
src/app/(erp)         every business screen; layout.tsx calls requireOrg()
src/app/(erp)/print   printable documents (browser print to PDF)
src/app/api           health, file streaming
src/components/ui     Button, fields, ActionForm/SubmitButton, PageHeader/Card/Badge/Stat/Tabs/DL
src/components/forms  shared form pieces (line editor, party forms, attachments, journal form)
src/lib               db (schema, factory, seed), auth, tenancy, numbering, audit, forms, money
src/modules/<m>       service.ts (domain logic, takes db/tx + actor), actions.ts ("use server"), tests
src/modules/assistant command parser (service.ts) and the confirm-then-execute actions behind Ctrl/Cmd+K
docs/                 glossary, module specs, posting rules
drizzle/              SQL migrations
scripts/              demo snapshot builder
```

## Invariants

1. **Tenancy.** Every business table has `org_id` and every query filters by it. Server actions
   and pages get it from `requireOrg()` (`src/lib/tenancy.ts`) and pass `{ orgId, userId }` into
   services. Never trust an id from a form without scoping the query by `orgId`.
2. **Append-only ledgers.** `inventory_transactions` and `journal_entries`/`journal_lines` are never
   updated or deleted. Mistakes are corrected with a reversing row (`reverseEntry`, opposite move).
3. **One transaction per business event.** A service that moves stock, touches a document and posts
   the ledger does it inside one `db.transaction`. Actions open the transaction; services accept
   `DbOrTx` and never open their own.
4. **Posting through rules only.** Money reaches the ledger through `postEvent(event, amount)` in
   `src/modules/books/service.ts`, which looks up `posting_rules` (event → debit/credit account
   subtype). Add new events to `DEFAULT_RULES` in `chart.ts`; never hard-code an account.
5. **Documents are header + lines + status machine** (quote, order, PO, work order, shipment,
   invoice, bill) and link to the document they came from (`quoteId`, `salesOrderLineId`,
   `shipmentId`...). Status is derived from lines where possible (`recomputeOrderStatus`).
6. **Inventory cost is moving weighted average** (`moveStock`). Inbound movements with a cost update
   `items.avgCost`; outbound movements use it. Sum(qty × unitCost) over transactions equals the
   GL inventory account; `src/modules/flow.test.ts` proves it and must keep passing.
7. **Numbering** via `nextNumber(db, orgId, key)` (`src/lib/numbering.ts`); never compute numbers
   in the UI.
8. **Audit** meaningful writes with `audit(...)` (`src/lib/audit.ts`).

## Conventions

- Server actions: `"use server"`, signature `(prev: ActionState, formData: FormData)`, parse with
  Zod via `formObject`/`formLines` (`src/lib/forms.ts`), wrap in `withFormErrors`, `redirect()` on
  success when the form will unmount, otherwise `revalidatePath` + `{ ok }`.
- Forms are uncontrolled: `<ActionForm action={...}>` + `<SubmitButton>`. Repeating lines are
  named `lines[i][field]`.
- Pages are async server components: `requireOrg()` → queries → JSX. No database calls from
  client components. Import `Link` from `@/components/ui/link` (no prefetching), not `next/link`.
- Money and quantity columns are `numeric` with `mode: "number"` (see `schema/_shared.ts`); round
  with `round4`/`round2`; format with `fmtMoney`/`fmtQty`/`fmtDate`.
- Ids are UUIDs; detail pages call `uuidOr404(id)` before querying.
- Dates in `date` columns are `YYYY-MM-DD` strings (`today()`, `addDays()`). Never call
  `Date.now()` or `Math.random()` during render.
- Keep screens plain: tables with class `data`, cards, one primary action per card. Page
  descriptions carry facts (counts, status), not explanations.
- The build must work offline: no fonts or data fetched at build time.

## Commands

```
npm run dev            # http://localhost:3000, embedded database in ./.data
npm run db:seed        # sample company (owner@kitwise.demo / kitwise-demo); db:reset wipes ./.data first
npm run test           # vitest: cost roll-up, quote-to-cash flow with books, importer
npm run typecheck && npm run lint && npm run build
npm run db:generate    # after editing src/lib/db/schema/*
npm run demo:snapshot  # rebuild data/demo.tar.gz, the database image used by demo mode
npm run check          # everything CI runs
```

## Definition of done

Typecheck, lint, tests and build pass; a schema change ships with a migration; a new business
event has a posting rule, a service function, a test in `flow.test.ts` or a module test, and an
audit entry; any new detail page validates its id; the sample company (`src/lib/db/seed.ts`) still
seeds. Never edit a shipped migration; add a new one.

## Assistant

The assistant (`src/modules/assistant`) maps plain-language requests to a fixed command set with
regular expressions, answers lookups from the same services the screens use, and returns a
`confirm` result for anything that writes; `execute` runs the confirmed command inside one
transaction and checks the role with `can`. Add a command in three places: a pattern in
`interpret`, a case in `execute`, and a line in the language-model system prompt so the optional
free-text fallback knows it exists.

## Not in scope yet

Row-level security policies (tenancy is enforced in the application layer and by tests), email
in and out, bank feeds, accounting exports, EDI, carrier labels, customer and vendor portals,
finite scheduling, multi-currency, sales-tax services, payroll. See `docs/specs/roadmap.md`.
