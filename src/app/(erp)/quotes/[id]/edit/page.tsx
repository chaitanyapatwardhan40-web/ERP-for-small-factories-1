import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { uuidOr404 } from "@/lib/ids";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { orgs, quoteLines, quotes } from "@/lib/db/schema";
import { pickCustomers, pickItems } from "@/lib/pick";
import { PageHeader } from "@/components/ui/page";
import { QuoteForm } from "@/components/forms/quote-form";
import { priceHintsFor } from "@/modules/sales/service";

export const metadata = { title: "Edit quote" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  uuidOr404(id);
  const ctx = await requireOrg();
  const db = await getDb();
  const [q] = await db.select().from(quotes).where(and(eq(quotes.id, id), eq(quotes.orgId, ctx.orgId)));
  if (!q) notFound();
  if (q.status === "accepted") redirect(`/quotes/${q.id}`);
  const [lines, customerList, itemList, [org], hints] = await Promise.all([
    db.select().from(quoteLines).where(eq(quoteLines.quoteId, q.id)).orderBy(asc(quoteLines.lineNo)),
    pickCustomers(db, ctx.orgId),
    pickItems(db, ctx.orgId),
    db.select().from(orgs).where(eq(orgs.id, ctx.orgId)),
    priceHintsFor(db, ctx.orgId, q.customerId, q.quoteDate),
  ]);
  return (
    <>
      <PageHeader
        title={`Edit ${q.number}`}
        description={q.status === "draft" ? "Draft" : `Saving creates revision ${q.revision + 1}`}
        crumbs={[
          { href: "/quotes", label: "Quotes" },
          { href: `/quotes/${q.id}`, label: q.number },
        ]}
      />
      <QuoteForm customers={customerList} items={itemList} quote={q} lines={lines} defaultMarginPct={org?.settings.defaultMarginPct ?? 30} overheadPct={org?.settings.overheadPct ?? 0} priceHints={hints} />
    </>
  );
}
