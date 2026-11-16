import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { memberships, orgs, sessions, users, type Role } from "@/lib/db/schema";

export const SESSION_COOKIE = "kw_session";
const SESSION_DAYS = 30;

export type SessionUser = { id: string; email: string; name: string };
export type Session = {
  id: string;
  user: SessionUser;
  org: { id: string; name: string; slug: string } | null;
  role: Role | null;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, orgId: string | null) {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, orgId, expiresAt });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  jar.delete(SESSION_COOKIE);
}

/** Switch the org the session is working in (must be a member). */
export async function switchSessionOrg(orgId: string) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return;
  const db = await getDb();
  await db.update(sessions).set({ orgId }).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({
      sessionId: sessions.id,
      orgId: sessions.orgId,
      userId: users.id,
      email: users.email,
      name: users.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;

  let org: Session["org"] = null;
  let role: Role | null = null;
  if (row.orgId) {
    const [m] = await db
      .select({ role: memberships.role, id: orgs.id, name: orgs.name, slug: orgs.slug })
      .from(memberships)
      .innerJoin(orgs, eq(orgs.id, memberships.orgId))
      .where(and(eq(memberships.userId, row.userId), eq(memberships.orgId, row.orgId)))
      .limit(1);
    if (m) {
      org = { id: m.id, name: m.name, slug: m.slug };
      role = m.role;
    }
  }
  return {
    id: row.sessionId,
    user: { id: row.userId, email: row.email, name: row.name },
    org,
    role,
  };
}
