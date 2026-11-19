import Link from "@/components/ui/link";
import { Card, PageHeader } from "@/components/ui/page";
import { requireOrg } from "@/lib/tenancy";
import { isDemo } from "@/lib/env";

export const metadata = { title: "Walkthrough" };

type Step = {
  title: string;
  where: { href: string; label: string };
  doing: string[];
  see: string[];
  ask?: string;
};

/**
 * One job, start to finish, on the sample company. Written so someone can
 * read it aloud while clicking: where to go, what to type, what changed.
 */
const STEPS: Step[] = [
  {
    title: "A lead comes in",
    where: { href: "/crm", label: "Leads" },
    doing: [
      "New lead: Helix Medical Devices, “30 sensor kits for Plant 2”, expected close in two weeks.",
      "Log a follow-up with a date; it shows on Today until it is done.",
      "Press New quote on the lead. Helix is already a customer, so it goes straight to a quote.",
    ],
    see: ["The lead moves to quoting and keeps a link to the quote."],
    ask: "follow up with Helix tomorrow: send the sensor kit quote",
  },
  {
    title: "Quote it",
    where: { href: "/quotes/new", label: "New quote" },
    doing: [
      "Customer Helix Medical Devices. Add KIT-SENSOR-SET, quantity 30.",
      "Leave the price blank: Helix has a price list, and 30 lands on the 25+ break at $215.",
      "Valid for 30 days, terms as you like. Create quote.",
      "Open Print / PDF to see what the customer gets, then Mark sent.",
    ],
    see: [
      "Estimated cost and gross margin on the right come from the kit’s BOM and routing, so you quote with the margin in view.",
      "Editing a sent quote bumps its revision; the customer-facing print shows it.",
    ],
    ask: "mark Q-00003 sent",
  },
  {
    title: "Win it",
    where: { href: "/quotes", label: "Quotes" },
    doing: [
      "On the quote: Won it? Type the customer’s PO number and press Accept and create sales order.",
      "On the new sales order press Confirm.",
    ],
    see: [
      "The quote is accepted and linked to the order; the lead is won.",
      "Confirm runs the credit check against Helix’s $75,000 limit (owners can override a hold).",
      "The order is confirmed and sits in the backlog on Today.",
    ],
    ask: "confirm this (on the order)",
  },
  {
    title: "Plan the work",
    where: { href: "/orders", label: "Sales orders" },
    doing: [
      "On the order press Create 1 work order. The kit is a make item, so it gets a work order for the open quantity, due on the promised date.",
      "Open the work order: materials come from the BOM, operations from the routing (pick, kit and label, final check).",
      "Materials short of stock are amber, with a link to What to buy.",
    ],
    see: ["The order is now in production, and its Work orders card tracks completion and operations as the job moves."],
  },
  {
    title: "Buy what is short",
    where: { href: "/purchasing/shortages", label: "What to buy" },
    doing: [
      "Press Create POs: one purchase order per vendor, costs from each vendor’s price list.",
      "On a PO: Mark sent, copy the email draft, then Receive when the goods arrive (per-line location, lot number, packing slip).",
      "Bill the received goods, then pay the bill from Vendor bills.",
    ],
    see: [
      "Receiving posts Inventory and Accrued purchases; the bill moves it to Payables; paying posts Cash.",
      "Over-receipt is allowed up to the tolerance in Settings; a short delivery can be closed short.",
    ],
    ask: "receive this (on the PO), then pay BILL-00012",
  },
  {
    title: "Build it",
    where: { href: "/shop-floor", label: "Shop floor" },
    doing: [
      "On the work order press Release to floor, then Issue all to pull the components from stock.",
      "On Shop floor, clock an employee in on the first operation; clock out with the good quantity. Or record labor on the work order itself.",
      "When the last operation is done, press Complete work order: good quantity, scrap and reason, and the location the kits go into.",
    ],
    see: [
      "Issuing moves component cost into WIP; labor adds hours at the employee’s rate plus overhead.",
      "Completion puts 30 kits into stock at actual cost and clears WIP. The work order shows the actual unit cost.",
      "The Schedule shows load by work center while this is open.",
    ],
    ask: "clock in Grace Kim on WO-00050",
  },
  {
    title: "Ship it",
    where: { href: "/orders", label: "Sales orders" },
    doing: [
      "On the order: Ship in full from MAIN, carrier and tracking, with Invoice it too ticked. Or Pack a shipment for a partial.",
      "Print the packing list and the certificate of conformance from the shipment.",
    ],
    see: ["Stock drops by 30; the order moves to shipped; cost of goods is posted at the actual cost of the kits."],
    ask: "ship this",
  },
  {
    title: "Invoice it",
    where: { href: "/invoices", label: "Invoices" },
    doing: [
      "If you did not invoice with the shipment, open the shipment and press Invoice.",
      "Open the invoice and print it. Discounts, freight and the customer’s terms are on it.",
    ],
    see: [
      "Receivables and revenue are posted; the invoice is due on Helix’s net-45 terms.",
      "A credit memo on the invoice reverses part or all of it, with an optional restock.",
    ],
    ask: "invoice this (on the shipment)",
  },
  {
    title: "Get paid",
    where: { href: "/invoices/receive", label: "Receive payment" },
    doing: [
      "Pick Helix, enter the amount and reference, and apply it across open invoices. Anything left stays as unapplied credit.",
      "Print a statement from the customer page.",
    ],
    see: ["Cash is posted, the invoice is paid, and AR aging on Reports goes down."],
    ask: "payment 6450 on INV-00087",
  },
  {
    title: "Look at the books",
    where: { href: "/books", label: "Ledger" },
    doing: [
      "Open the Ledger: every step above posted its own entry, each linked to the document that caused it.",
      "Reports: P&L, balance sheet, cash flow, AR and AP aging, sales tax, and the month-end close checklist.",
    ],
    see: ["Nobody did bookkeeping; the shop-floor events did it."],
    ask: "how are we doing",
  },
];

export default async function WalkthroughPage() {
  await requireOrg();
  const demo = isDemo();
  return (
    <>
      <PageHeader
        title="Quote to cash, start to finish"
        description="One job through the whole system. Read a step, click through to the screen, come back for the next."
      />
      {demo ? (
        <p className="mb-5 max-w-3xl text-sm text-ink-2">
          This workspace is the sample company, Northline Kitting &amp; Assembly, so the customer, prices, kit and vendors below already exist. Everything you do here is kept for a while and then reset, so
          nothing can go wrong.
        </p>
      ) : null}
      <ol className="max-w-3xl space-y-4">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <Card
              title={
                <span className="flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-white">{i + 1}</span>
                  {s.title}
                </span>
              }
              actions={
                <Link href={s.where.href} className="text-sm text-brand hover:underline">
                  {s.where.label} →
                </Link>
              }
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-3">Do</div>
                  <ul className="list-inside list-disc space-y-1 text-sm">
                    {s.doing.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-3">What changed</div>
                  <ul className="list-inside list-disc space-y-1 text-sm text-ink-2">
                    {s.see.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                  {s.ask ? (
                    <p className="mt-2 text-xs text-ink-3">
                      Or press <kbd className="rounded border border-line bg-paper px-1">Ctrl K</kbd> and type: <span className="font-mono text-ink-2">{s.ask}</span>
                    </p>
                  ) : null}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>
      <p className="mt-6 max-w-3xl text-sm text-ink-3">
        Done? Drafts you no longer want can be deleted from their own page (quotes, orders, work orders and purchase orders with nothing received, shipped or billed). Anything further along is
        cancelled or closed so the paper trail stays.
      </p>
    </>
  );
}
