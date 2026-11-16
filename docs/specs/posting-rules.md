# Posting rules

Every event that moves money posts one balanced journal entry through `postEvent`. The rule table
is seeded per org from `DEFAULT_RULES` (`src/modules/books/chart.ts`) and editable under
Books → Chart, rules, periods. Rules point at account **subtypes**.

| Event | Debit | Credit | Fired by |
| --- | --- | --- | --- |
| purchase.receipt | inventory | accrued_purchases | receivePurchaseOrder (stock items) |
| production.outside | wip | accrued_purchases | receivePurchaseOrder (PO raised from a work order) |
| purchase.bill | accrued_purchases | accounts_payable | createBillFromPo |
| purchase.expense_bill | operating_expense (or chosen) | accounts_payable | createExpenseBill, tax/freight on PO bills |
| purchase.payment | accounts_payable | cash | payBill |
| production.issue | wip | inventory | issueMaterial / issueAllMaterials |
| production.return | inventory | wip | (reserved) |
| production.labor | wip | labor_absorbed | clockOut / recordLabor |
| production.overhead | wip | overhead_absorbed | completeWorkOrder |
| production.complete | inventory | wip | completeWorkOrder (good units) |
| production.scrap | scrap_expense | wip | completeWorkOrder (scrapped units) |
| sales.ship | cogs | inventory | shipShipment |
| sales.invoice | accounts_receivable | revenue | createInvoiceFromShipment |
| sales.tax | accounts_receivable | sales_tax_payable | createInvoiceFromShipment |
| sales.payment | cash | accounts_receivable | recordCustomerPayment |
| inventory.opening | inventory | owner_equity | imports, opening receipts |
| inventory.adjust_up | inventory | inventory_adjustment | counts / adjustments |
| inventory.adjust_down | inventory_adjustment | inventory | counts / adjustments |
| inventory.scrap | scrap_expense | inventory | scrap from stock |

Invariants (tested in `src/modules/flow.test.ts`):

- Every journal entry balances.
- Σ(qty × unit cost) over `inventory_transactions` = balance of the `inventory` subtype.
- WIP returns to zero when a work order completes with no scrap.
- Assets = liabilities + equity (including current earnings) on the balance sheet.

Labour and overhead absorbed are credit-balance expense accounts: they move payroll cost into WIP,
then into inventory and COGS. On the P&L they show as negative expenses; the payroll bill itself is
recorded as payroll_expense when it arrives.
