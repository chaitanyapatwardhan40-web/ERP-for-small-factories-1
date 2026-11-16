import { Sidebar } from "@/components/layout/sidebar";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { orgsForUser } from "@/modules/platform/service";
import { logoutAction, switchOrgAction } from "@/modules/platform/actions";

export const dynamic = "force-dynamic";

export default async function ErpLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrg();
  const db = await getDb();
  const mine = await orgsForUser(db, ctx.userId);
  return (
    <div className="flex min-h-screen">
      <div className="no-print sticky top-0 h-screen">
        <Sidebar orgName={ctx.session.org!.name} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-12 items-center justify-between border-b border-line bg-white px-5">
          <div className="text-sm text-ink-3">
            {ctx.session.user.name} · <span className="capitalize">{ctx.role}</span>
          </div>
          <div className="flex items-center gap-3">
            {mine.length > 1 ? (
              <form action={switchOrgAction}>
                <select name="orgId" defaultValue={ctx.orgId} className="rounded-md border border-line bg-white px-2 py-1 text-sm">
                  {mine.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <button className="ml-1 text-xs text-brand hover:underline" type="submit">
                  switch
                </button>
              </form>
            ) : null}
            <form action={logoutAction}>
              <button className="text-sm text-ink-2 hover:text-ink" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 px-6 py-5">{children}</main>
      </div>
    </div>
  );
}
