import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { isDemo } from "@/lib/env";
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

function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}

// --- Demo mode: stateless signed cookies ------------------------------------
// Serverless instances in demo mode each hold their own in-memory database, so
// a session row written by one instance would be unknown to the next. The
// cookie therefore carries the user and org ids with a signature instead.
// The data behind it is the public sample company, so the key only needs to
// be the same on every instance, not secret.
const DEMO_PREFIX = "d1.";

function demoKey() {
  return createHash("sha256")
    .update(`kitwise-demo:${process.env.SESSION_SECRET ?? process.env.VERCEL_PROJECT_PRODUCTION_URL ?? ""}`)
    .digest();
}

function signDemo(payload: string) {
  return createHmac("sha256", demoKey()).update(payload).digest("base64url");
}

function demoToken(userId: string, orgId: string | null, expiresAt: Date) {
  const payload = `${userId}.${orgId ?? "-"}.${expiresAt.getTime()}`;
  return `${DEMO_PREFIX}${payload}.${signDemo(payload)}`;
}

function parseDemoToken(token: string): { userId: string; orgId: string | null } | null {
  if (!token.startsWith(DEMO_PREFIX)) return null;
  const parts = token.slice(DEMO_PREFIX.length).split(".");
  if (parts.length !== 4) return null;
  const [userId, org, exp, sig] = parts;
  const expected = signDemo(`${userId}.${org}.${exp}`);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  return { userId, orgId: org === "-" ? null : org };
}

// -----------------------------------------------------------------------------

export async function createSession(userId: string, orgId: string | null) {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const jar = await cookies();
  if (isDemo()) {
    jar.set(SESSION_COOKIE, demoToken(userId, orgId, expiresAt), cookieOptions(expiresAt));
    return;
  }
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, orgId, expiresAt });
  jar.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token && !token.startsWith(DEMO_PREFIX)) {
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
  const demo = parseDemoToken(token);
  if (demo) {
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    jar.set(SESSION_COOKIE, demoToken(demo.userId, orgId, expiresAt), cookieOptions(expiresAt));
    return;
  }
  const db = await getDb();
  await db.update(sessions).set({ orgId }).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();

  let row: { sessionId: string; orgId: string | null; userId: string; email: string; name: string } | undefined;
  const demo = parseDemoToken(token);
  if (demo) {
    const [u] = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.id, demo.userId)).limit(1);
    if (!u) return null;
    row = { sessionId: "demo", orgId: demo.orgId, userId: u.id, email: u.email, name: u.name };
  } else {
    [row] = await db
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
  }
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
