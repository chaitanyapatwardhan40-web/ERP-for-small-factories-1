import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { exportRows, toCsv } from "@/modules/reports/export";

export const dynamic = "force-dynamic";

/** CSV export of a list screen: /api/export?kind=orders&status=open */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.org) return new Response("Sign in first", { status: 401 });
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const kind = params.kind ?? "";
  const db = await getDb();
  const data = await exportRows(db, session.org.id, kind, params);
  if (!data) return new Response("Unknown export", { status: 404 });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(data), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${data.filename}-${stamp}.csv"`,
    },
  });
}
