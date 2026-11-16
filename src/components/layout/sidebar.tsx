"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavGroup = { label: string; items: { href: string; label: string }[] };

export const NAV: NavGroup[] = [
  { label: "", items: [{ href: "/", label: "Today" }] },
  {
    label: "Sell",
    items: [
      { href: "/crm", label: "Leads & marketing" },
      { href: "/customers", label: "Customers" },
      { href: "/quotes", label: "Quotes" },
      { href: "/orders", label: "Sales orders" },
    ],
  },
  {
    label: "Make",
    items: [
      { href: "/items", label: "Items & BOMs" },
      { href: "/work-orders", label: "Work orders" },
      { href: "/schedule", label: "Schedule" },
      { href: "/shop-floor", label: "Shop floor" },
    ],
  },
  {
    label: "Buy & stock",
    items: [
      { href: "/vendors", label: "Vendors" },
      { href: "/purchasing", label: "Purchase orders" },
      { href: "/purchasing/shortages", label: "What to buy" },
      { href: "/inventory", label: "Inventory" },
    ],
  },
  {
    label: "Ship & bill",
    items: [
      { href: "/shipments", label: "Shipments" },
      { href: "/invoices", label: "Invoices" },
      { href: "/bills", label: "Vendor bills" },
    ],
  },
  {
    label: "Books",
    items: [
      { href: "/books", label: "Ledger" },
      { href: "/books/reports", label: "Reports" },
      { href: "/books/accounts", label: "Chart & rules" },
    ],
  },
  {
    label: "Quality",
    items: [
      { href: "/quality", label: "Inspections" },
      { href: "/quality/ncrs", label: "NCRs & CAPAs" },
      { href: "/quality/gauges", label: "Gauges" },
    ],
  },
  {
    label: "People & machines",
    items: [
      { href: "/people", label: "Employees" },
      { href: "/maintenance", label: "Maintenance" },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/documents", label: "Documents" },
      { href: "/import", label: "Import (implementer)" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

export function Sidebar({ orgName }: { orgName: string }) {
  const pathname = usePathname();
  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    // Longest matching href wins so /purchasing/shortages doesn't light /purchasing.
    const all = NAV.flatMap((g) => g.items.map((i) => i.href)).filter((h) => h !== "/" && pathname.startsWith(h));
    const best = all.sort((a, b) => b.length - a.length)[0];
    return best === href;
  };
  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-line bg-white">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-sm font-bold text-white">K</div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{orgName}</div>
          <div className="text-[11px] text-ink-3">Kitwise</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-2 text-sm">
        {NAV.map((g) => (
          <div key={g.label} className="mb-2">
            {g.label ? <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{g.label}</div> : null}
            {g.items.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                className={`block rounded-md px-2 py-1.5 ${isActive(i.href) ? "bg-brand-soft font-medium text-brand-dark" : "text-ink-2 hover:bg-paper hover:text-ink"}`}
              >
                {i.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
