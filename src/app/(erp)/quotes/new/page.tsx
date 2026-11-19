import { eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { orgs } from "@/lib/db/schema";
import { pickCustomers, pickItems } from "@/lib/pick";
import { PageHeader } from "@/components/ui/page";
import { QuoteForm } from "@/components/forms/quote-form";
import { priceHintsFor } from "@/modules/sales/service";
import { today } from "@/lib/money";

export const metadata = { title: "New quote" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ customerId?: string; leadId?: string }> }) {
  const { customerId, leadId } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const [customerList, itemList, [org], hints] = await Promise.all([pickCustomers(db, ctx.orgId), pickItems(db, ctx.orgId), db.select().from(orgs).where(eq(orgs.id, ctx.orgId)), priceHintsFor(db, ctx.orgId, customerId ?? null, today())]);
  return (
    <>
      <PageHeader title="New quote" crumbs={[{ href: "/quotes", label: "Quotes" }]} />
      <QuoteForm
        customers={customerList}
        items={itemList}
        defaults={{ customerId, leadId }}
        defaultMarginPct={org?.settings.defaultMarginPct ?? 30}
        overheadPct={org?.settings.overheadPct ?? 0}
        priceHints={hints}
        standardTerms={org?.settings.documents?.quoteTerms}
      />
    </>
  );
}
