import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { isDemo } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, db: process.env.DATABASE_URL ? "postgres" : isDemo() ? "demo" : "embedded" });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
