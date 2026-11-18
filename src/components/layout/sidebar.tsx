"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mark } from "@/components/brand";

export type NavGroup = { label: string; items: { href: string; label: string }[] };

export const NAV: NavGroup[] = [
  { label: "", items: [{ href: "/", label: "Today" }] },
  {
    label: "Sell",
    items: [
      { href: "/crm", label: "Leads" },
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
    label: "Admin",
    items: [
      { href: "/documents", label: "Documents" },
      { href: "/import", label: "Import data" },
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
    <aside className="flex h-screen w-56 shrink-0 flex-col bg-side text-side-text">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <Mark size={26} className="shrink-0 text-brand" />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium leading-tight text-white">{orgName}</div>
          <div className="text-[11px] leading-tight text-side-muted">Kitwise</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4 text-[13px]">
        {NAV.map((g) => (
          <div key={g.label} className="mb-1.5">
            {g.label ? <div className="px-2 pb-1 pt-3 text-[10.5px] font-medium uppercase tracking-[0.08em] text-side-muted">{g.label}</div> : null}
            {g.items.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                className={`block rounded px-2 py-[5px] ${isActive(i.href) ? "bg-brand font-medium text-white" : "hover:bg-side-2 hover:text-white"}`}
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
