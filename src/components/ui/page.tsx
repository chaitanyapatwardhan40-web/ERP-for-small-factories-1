import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  crumbs,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  crumbs?: { href: string; label: string }[];
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        {crumbs?.length ? (
          <div className="mb-1 flex items-center gap-1 text-xs text-ink-3">
            {crumbs.map((c, i) => (
              <span key={c.href} className="flex items-center gap-1">
                {i > 0 ? <span>/</span> : null}
                <Link href={c.href} className="hover:text-ink">
                  {c.label}
                </Link>
              </span>
            ))}
          </div>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  children,
  className = "",
  actions,
  padded = true,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className={`rounded-md border border-line bg-white shadow-xs ${className}`}>
      {title ? (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      ) : null}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line bg-white px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="mt-1 text-sm text-ink-3">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

const tones: Record<string, string> = {
  neutral: "bg-paper text-ink-2 border-line",
  info: "bg-brand-soft text-brand-dark border-brand/20",
  good: "bg-good-soft text-good border-good/20",
  warn: "bg-warn-soft text-warn border-warn/20",
  bad: "bg-bad-soft text-bad border-bad/20",
};

const statusTone: Record<string, keyof typeof tones> = {
  draft: "neutral",
  planned: "neutral",
  pending: "neutral",
  new: "neutral",
  sent: "info",
  confirmed: "info",
  released: "info",
  issued: "info",
  approved: "info",
  contacted: "info",
  quoting: "info",
  in_progress: "warn",
  in_production: "warn",
  partially_shipped: "warn",
  partially_received: "warn",
  open: "warn",
  due: "warn",
  down: "bad",
  fail: "bad",
  failed: "bad",
  lost: "bad",
  cancelled: "bad",
  void: "bad",
  expired: "bad",
  out_of_service: "bad",
  accepted: "good",
  shipped: "good",
  received: "good",
  complete: "good",
  closed: "good",
  paid: "good",
  invoiced: "good",
  active: "good",
  pass: "good",
  passed: "good",
  won: "good",
  verified: "good",
  running: "good",
  in_service: "good",
};

export function Badge({ children, tone }: { children: ReactNode; tone?: keyof typeof tones }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-px text-[11px] font-medium ${tones[tone ?? "neutral"]}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone[status] ?? "neutral"}>{status.replaceAll("_", " ")}</Badge>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-ink";
  return (
    <div className="rounded-md border border-line bg-white px-4 py-3 shadow-xs">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-ink-3">{hint}</div> : null}
    </div>
  );
}

export function Tabs({ tabs, current }: { tabs: { href: string; label: string }[]; current: string }) {
  return (
    <nav className="mb-4 flex gap-1 border-b border-line">
      {tabs.map((t) => {
        const active = t.href === current;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${active ? "border-brand font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function DL({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="text-ink">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
