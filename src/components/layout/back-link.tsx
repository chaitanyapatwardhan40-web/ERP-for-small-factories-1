"use client";

import { usePathname } from "next/navigation";
import Link from "@/components/ui/link";
import { NAV } from "@/components/layout/sidebar";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a record under each section is called, for "Back to order" on sub-pages. */
const RECORD: Record<string, string> = {
  orders: "order",
  quotes: "quote",
  purchasing: "purchase order",
  "work-orders": "work order",
  invoices: "invoice",
  shipments: "shipment",
  bills: "bill",
  customers: "customer",
  vendors: "vendor",
  items: "item",
  crm: "lead",
  people: "employee",
  maintenance: "machine",
  books: "entry",
  quality: "inspection",
  documents: "document",
};

/** Where "back" goes from a path: the list it belongs to, or the record above a sub-page. */
export function parentOf(pathname: string): { href: string; label: string } | null {
  const segs = pathname.split("/").filter(Boolean);
  if (!segs.length) return null;
  const nav = NAV.flatMap((g) => g.items);
  if (nav.some((n) => n.href === pathname)) return null;
  const parentSegs = segs.slice(0, -1);
  const href = parentSegs.length ? `/${parentSegs.join("/")}` : "/";
  const direct = nav.find((n) => n.href === href);
  if (direct) return direct;
  if (parentSegs.length && UUID.test(parentSegs[parentSegs.length - 1])) {
    return { href, label: `Back to ${RECORD[parentSegs[0]] ?? "record"}` };
  }
  const above = nav
    .filter((n) => n.href !== "/" && pathname.startsWith(`${n.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return above ?? { href: "/", label: "Today" };
}

export function BackLink({ crumbs }: { crumbs?: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const trail = crumbs?.length ? crumbs : [parentOf(pathname)].filter((c): c is { href: string; label: string } => !!c);
  if (!trail.length) return null;
  return (
    <div className="no-print mb-1.5 flex items-center gap-1 text-[13px] text-ink-2">
      <Link href={trail[0].href} className="inline-flex items-center gap-1 hover:text-ink" title="Back">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M10 3 5 8l5 5" />
        </svg>
        {trail[0].label}
      </Link>
      {trail.slice(1).map((c) => (
        <span key={c.href} className="flex items-center gap-1">
          <span className="text-ink-3">/</span>
          <Link href={c.href} className="hover:text-ink">
            {c.label}
          </Link>
        </span>
      ))}
    </div>
  );
}
