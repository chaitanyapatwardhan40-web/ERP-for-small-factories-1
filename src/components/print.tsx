import type { ReactNode } from "react";
import type { orgs } from "@/lib/db/schema";
import { formatAddress } from "@/lib/forms";
import { PrintButton } from "./print-button";

/**
 * A printable business document (quote, order acknowledgement, PO, pack
 * list, invoice, traveler). The browser's print-to-PDF is the PDF engine,
 * which keeps the server free of headless Chrome. The company block comes
 * from Settings → Company.
 */
export function PrintDoc({
  title,
  number,
  org,
  meta,
  party,
  secondParty,
  children,
  notes,
  terms,
  footer,
}: {
  title: string;
  number: string;
  org: typeof orgs.$inferSelect | undefined;
  meta: [string, ReactNode][];
  party?: { label: string; name: string; lines?: string[] };
  secondParty?: { label: string; name?: string; lines?: string[] };
  children: ReactNode;
  notes?: string | null;
  terms?: string | null;
  footer?: ReactNode;
}) {
  const company = org?.settings.company;
  const companyLines = [...formatAddress(company?.address), company?.phone, company?.email, company?.website].filter(Boolean) as string[];
  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-sm text-ink print:p-0">
      <div className="no-print mb-4 flex justify-end">
        <PrintButton />
      </div>
      <div className="mb-6 flex items-start justify-between border-b border-line pb-4">
        <div>
          <div className="text-xl font-semibold">{company?.legalName || org?.name || ""}</div>
          {companyLines.map((l, i) => (
            <div key={i} className="text-xs text-ink-2">
              {l}
            </div>
          ))}
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold uppercase tracking-wide">{title}</div>
          <div className="font-mono text-sm">{number}</div>
        </div>
      </div>
      <div className={`mb-6 grid gap-6 ${secondParty ? "grid-cols-3" : "grid-cols-2"}`}>
        {party ? (
          <div>
            <div className="text-xs font-semibold uppercase text-ink-3">{party.label}</div>
            <div className="font-medium">{party.name}</div>
            {party.lines?.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        ) : (
          <div />
        )}
        {secondParty ? (
          <div>
            <div className="text-xs font-semibold uppercase text-ink-3">{secondParty.label}</div>
            {secondParty.name ? <div className="font-medium">{secondParty.name}</div> : null}
            {secondParty.lines?.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        ) : null}
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-right">
          {meta.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-3">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {children}
      {notes ? (
        <div className="mt-6 whitespace-pre-wrap rounded border border-line p-3 text-xs">
          <div className="mb-1 font-semibold uppercase text-ink-3">Notes</div>
          {notes}
        </div>
      ) : null}
      {terms ? <div className="mt-6 whitespace-pre-wrap text-xs text-ink-2">{terms}</div> : null}
      {footer ? <div className="mt-6 text-xs text-ink-3">{footer}</div> : null}
    </div>
  );
}
