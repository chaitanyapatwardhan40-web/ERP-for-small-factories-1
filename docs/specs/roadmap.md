# Roadmap (what is not built yet, in the order it should be)

Phase gates are passed by pilot shops, not demos. See the plan doc for the gates.

## Next

1. **Row-level security.** Add `app.org_id` session setting + policies in a migration; wrap requests in
   `set local`. Tenancy is currently enforced in application code and tests.
2. **Email in and out (Resend).** Quote, acknowledgement, PO, invoice, campaign sending; an inbox
   address that turns forwarded RFQs, customer POs, vendor confirmations and invoices into draft
   records (the inbox agent). Drafts land in a "proposed changes" list, never straight into the books.
3. **Implementer v2.** QuickBooks exports (customers, vendors, items, open AR/AP, trial balance as
   opening balances), drawings → items (part number read from the title block), old quotes →
   price history. Keep every import idempotent.
4. **QuickBooks Online sync** for shops that keep their accountant on QuickBooks during transition:
   invoices, bills, payments mirrored; a 90-day mirror before switching the ledger off.
5. **Scheduling v2.** Finite capacity by day per work center, drag-and-drop sequence, machine downtime
   blocking capacity, promised-date feasibility check on order confirmation.
6. **Backflush** option per item, lot/serial traceability report (where did heat H24-123 go).
7. **Customer and vendor portals** with magic links: order status, certs, quote approval, PO
   confirmation.
8. **Bank feeds (Plaid)** and reconciliation; sales tax service; 1099 report.
9. **Vercel Workflows** for long jobs: large imports, MRP regeneration, month-end checks.

## Deferred on purpose

Multi-currency, process manufacturing (batches, yields), EDI (through a provider when a customer
forces it), payroll (Gusto), carrier labels (EasyPost), CAD integration.
