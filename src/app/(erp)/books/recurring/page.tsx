import { and, asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { Card, PageHeader, Tabs } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/fields";
import { TemplateForm } from "@/components/forms/template-form";
import { deleteTemplateAction, postTemplateAction } from "@/modules/books/actions";
import { listTemplates } from "@/modules/books/extras";
import { fmtDate, fmtMoney, today } from "@/lib/money";
import { BOOKS_TABS } from "../tabs";

export const metadata = { title: "Recurring entries" };

export default async function RecurringPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams;
  const ctx = await requireOrg();
  const db = await getDb();
  const [templates, accts] = await Promise.all([
    listTemplates(db, ctx.orgId),
    db.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts).where(and(eq(accounts.orgId, ctx.orgId), eq(accounts.active, true))).orderBy(asc(accounts.code)),
  ]);
  const editing = templates.find((t) => t.id === edit);
  const t = today();
  return (
    <>
      <PageHeader title="Recurring entries" description="Depreciation, accruals, rent, loan interest: set up once, post each period." />
      <Tabs tabs={BOOKS_TABS} current="/books/recurring" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Templates" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Frequency</th>
                  <th>Next</th>
                  <th>Last posted</th>
                  <th className="num">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {templates.map((tp) => {
                  const amount = tp.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
                  const due = tp.nextDate && tp.nextDate <= t;
                  return (
                    <tr key={tp.id}>
                      <td>
                        <a href={`/books/recurring?edit=${tp.id}`} className="font-medium text-brand hover:underline">
                          {tp.name}
                        </a>
                        {tp.memo ? <div className="text-xs text-ink-3">{tp.memo}</div> : null}
                      </td>
                      <td>{tp.frequency}</td>
                      <td className={due ? "font-medium text-warn" : ""}>{fmtDate(tp.nextDate) || "—"}</td>
                      <td>{fmtDate(tp.lastPostedAt) || "—"}</td>
                      <td className="num">{fmtMoney(amount)}</td>
                      <td>
                        <div className="flex items-center justify-end gap-2">
                          <ActionForm action={postTemplateAction} className="flex items-center gap-1">
                            <input type="hidden" name="id" value={tp.id} />
                            <Input name="date" type="date" defaultValue={tp.nextDate && tp.nextDate <= t ? tp.nextDate : t} className="w-36" />
                            <SubmitButton size="sm" variant="secondary">
                              Post
                            </SubmitButton>
                          </ActionForm>
                          <form action={deleteTemplateAction}>
                            <input type="hidden" name="id" value={tp.id} />
                            <button className="text-xs text-ink-3 hover:text-bad" type="submit">
                              Delete
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!templates.length ? (
                  <tr>
                    <td colSpan={6} className="text-ink-3">
                      No templates yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
        </div>
        <Card title={editing ? `Edit ${editing.name}` : "New template"}>
          <TemplateForm key={editing?.id ?? "new"} accounts={accts} template={editing} />
        </Card>
      </div>
    </>
  );
}
