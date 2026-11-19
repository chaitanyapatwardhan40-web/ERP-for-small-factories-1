import { Sidebar } from "@/components/layout/sidebar";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { isDemo } from "@/lib/env";
import { orgsForUser } from "@/modules/platform/service";
import { AssistantPanel } from "@/components/assistant/panel";
import { ASSISTANT_PLACEHOLDER } from "@/modules/assistant/service";
import { Suspense } from "react";
import { logoutAction, switchOrgAction } from "@/modules/platform/actions";

export const dynamic = "force-dynamic";

export default async function ErpLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrg();
  const db = await getDb();
  const mine = await orgsForUser(db, ctx.userId);
  const demo = isDemo();
  return (
    <div className="flex min-h-screen">
      <div className="no-print sticky top-0 h-screen">
        <Sidebar orgName={ctx.session.org!.name} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {demo ? (
          <div className="no-print border-b border-warn/20 bg-warn-soft px-5 py-1.5 text-xs text-warn">
            Demo workspace. Sample data; changes are kept for a while and then reset.
          </div>
        ) : null}
        <header className="no-print flex h-11 items-center justify-between border-b border-line bg-white px-5">
          <div className="text-[13px] text-ink-2">
            {ctx.session.user.name} <span className="capitalize text-ink-3">· {ctx.role}</span>
          </div>
          <div className="flex items-center gap-3">
            {mine.length > 1 ? (
              <form action={switchOrgAction}>
                <select name="orgId" defaultValue={ctx.orgId} className="rounded border border-line bg-white px-2 py-1 text-[13px]">
                  {mine.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <button className="ml-1 text-xs text-brand hover:underline" type="submit">
                  Switch
                </button>
              </form>
            ) : null}
            <form action={logoutAction}>
              <button className="text-[13px] text-ink-2 hover:text-ink" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 px-6 py-5">{children}</main>
      </div>
      <Suspense fallback={null}>
        <AssistantPanel placeholder={ASSISTANT_PLACEHOLDER} />
      </Suspense>
    </div>
  );
}
