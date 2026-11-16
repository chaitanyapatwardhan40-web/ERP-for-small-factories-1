import "server-only";
import { redirect } from "next/navigation";
import { getSession, type Session } from "@/lib/auth/session";
import type { Role } from "@/lib/db/schema";

/**
 * The context every server action and page runs in. orgId is mandatory for
 * every query; passing it explicitly is the tenancy rule of the codebase.
 */
export type Ctx = {
  orgId: string;
  userId: string;
  role: Role;
  session: Session;
};

export async function requireOrg(): Promise<Ctx> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.org || !session.role) redirect("/onboarding");
  return { orgId: session.org.id, userId: session.user.id, role: session.role, session };
}

/** Permission matrix. Keep it boring: five roles, a handful of capabilities. */
const CAPS: Record<string, Role[]> = {
  "master.edit": ["owner", "office"],
  "sales.edit": ["owner", "office"],
  "purchasing.edit": ["owner", "office"],
  "inventory.edit": ["owner", "office", "shop"],
  "production.edit": ["owner", "office", "shop"],
  "shopfloor.clock": ["owner", "office", "shop"],
  "quality.edit": ["owner", "office", "shop"],
  "books.edit": ["owner", "accountant"],
  "books.view": ["owner", "accountant", "office"],
  "settings.edit": ["owner"],
  "crm.edit": ["owner", "office"],
  "maintenance.edit": ["owner", "office", "shop"],
};

export function can(role: Role, cap: keyof typeof CAPS | string): boolean {
  const allowed = CAPS[cap];
  if (!allowed) return role === "owner";
  return allowed.includes(role);
}

export class Forbidden extends Error {
  constructor(cap: string) {
    super(`Your role cannot do this (${cap}).`);
  }
}

export function assertCan(ctx: Ctx, cap: string) {
  if (!can(ctx.role, cap)) throw new Forbidden(cap);
}
