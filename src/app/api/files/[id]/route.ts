import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { attachments } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { readFile } from "@/modules/documents/storage";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session?.org) return new Response("Unauthorized", { status: 401 });
  const db = await getDb();
  const [row] = await db.select().from(attachments).where(and(eq(attachments.id, id), eq(attachments.orgId, session.org.id)));
  if (!row) return new Response("Not found", { status: 404 });
  const file = await readFile(row.storageKey);
  if (file.redirect) return Response.redirect(file.redirect, 302);
  return new Response(new Uint8Array(file.data!), {
    headers: {
      "Content-Type": row.mime,
      "Content-Disposition": `inline; filename="${encodeURIComponent(row.filename)}"`,
      "Cache-Control": "private, max-age=0",
    },
  });
}
