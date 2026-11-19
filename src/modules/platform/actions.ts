"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { memberships, orgs, users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, getSession, switchSessionOrg } from "@/lib/auth/session";
import { requireOrg, assertCan } from "@/lib/tenancy";
import { audit } from "@/lib/audit";
import { formObject, optNum, optStr, pickAddress, reqStr, withFormErrors } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";
import { addMember, createOrg, orgsForUser, registerUser } from "./service";
import { revalidatePath } from "next/cache";

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const input = z
      .object({ name: reqStr, email: z.string().email(), password: z.string().min(8), shopName: reqStr })
      .parse(formObject(formData));
    const db = await getDb();
    const user = await registerUser(db, input);
    const org = await createOrg(db, { name: input.shopName, ownerUserId: user.id });
    await createSession(user.id, org.id);
    redirect("/");
  });
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const input = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(formObject(formData));
    const db = await getDb();
    const [user] = await db.select().from(users).where(eq(users.email, input.email.trim().toLowerCase()));
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      return { error: "Email or password is wrong." };
    }
    const mine = await orgsForUser(db, user.id);
    await createSession(user.id, mine[0]?.id ?? null);
    redirect(mine.length ? "/" : "/onboarding");
  });
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function createOrgAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const session = await getSession();
    if (!session) redirect("/login");
    const input = z.object({ shopName: reqStr, overheadPct: optNum, taxRatePct: optNum }).parse(formObject(formData));
    const db = await getDb();
    const org = await createOrg(db, { name: input.shopName, ownerUserId: session.user.id, overheadPct: input.overheadPct, taxRatePct: input.taxRatePct });
    await switchSessionOrg(org.id);
    redirect("/");
  });
}

export async function switchOrgAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  const orgId = String(formData.get("orgId") ?? "");
  const db = await getDb();
  const mine = await orgsForUser(db, session.user.id);
  if (mine.some((o) => o.id === orgId)) await switchSessionOrg(orgId);
  redirect("/");
}

export async function updateSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "settings.edit");
    const raw = formObject(formData);
    const input = z
      .object({
        name: reqStr,
        currency: z.string().length(3).default("USD"),
        defaultTermsDays: optNum,
        defaultTaxRatePct: optNum,
        overheadPct: optNum,
        defaultMarginPct: optNum,
        overReceiptPct: optNum,
        legalName: optStr,
        phone: optStr,
        email: optStr,
        website: optStr,
        taxId: optStr,
        quoteTerms: optStr,
        poTerms: optStr,
        invoiceTerms: optStr,
        invoiceFooter: optStr,
      })
      .parse(raw);
    const db = await getDb();
    const [org] = await db.select().from(orgs).where(eq(orgs.id, ctx.orgId));
    const address = pickAddress(raw, "co") ?? org.settings.company?.address;
    await db
      .update(orgs)
      .set({
        name: input.name,
        settings: {
          ...org.settings,
          currency: input.currency,
          defaultTermsDays: input.defaultTermsDays ?? org.settings.defaultTermsDays,
          defaultTaxRatePct: input.defaultTaxRatePct ?? org.settings.defaultTaxRatePct,
          overheadPct: input.overheadPct ?? org.settings.overheadPct,
          defaultMarginPct: input.defaultMarginPct ?? org.settings.defaultMarginPct,
          overReceiptPct: input.overReceiptPct ?? org.settings.overReceiptPct ?? 0,
          company: {
            legalName: input.legalName || undefined,
            address: address ?? undefined,
            phone: input.phone || undefined,
            email: input.email || undefined,
            website: input.website || undefined,
            taxId: input.taxId || undefined,
          },
          documents: {
            quoteTerms: input.quoteTerms || undefined,
            poTerms: input.poTerms || undefined,
            invoiceTerms: input.invoiceTerms || undefined,
            invoiceFooter: input.invoiceFooter || undefined,
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(orgs.id, ctx.orgId));
    revalidatePath("/settings");
    return { ok: "Settings saved." };
  });
}

export async function addMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "settings.edit");
    const input = z
      .object({ email: z.string().email(), role: z.enum(["owner", "office", "shop", "accountant", "readonly"]) })
      .parse(formObject(formData));
    const db = await getDb();
    await addMember(db, ctx.orgId, input.email, input.role);
    revalidatePath("/settings");
    return { ok: `${input.email} is now ${input.role}.` };
  });
}

export async function removeMemberAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "settings.edit");
  const id = String(formData.get("id") ?? "");
  const db = await getDb();
  const [m] = await db.select().from(memberships).where(eq(memberships.id, id));
  if (m && m.orgId === ctx.orgId && m.userId !== ctx.userId) {
    await db.delete(memberships).where(eq(memberships.id, id));
  }
  revalidatePath("/settings");
}

export async function changeRoleAction(formData: FormData) {
  const ctx = await requireOrg();
  assertCan(ctx, "settings.edit");
  const id = String(formData.get("id") ?? "");
  const role = String(formData.get("role") ?? "") as "owner" | "office" | "shop" | "accountant" | "readonly";
  const db = await getDb();
  const [m] = await db.select().from(memberships).where(eq(memberships.id, id));
  if (m && m.orgId === ctx.orgId && m.userId !== ctx.userId && ["owner", "office", "shop", "accountant", "readonly"].includes(role)) {
    await db.update(memberships).set({ role }).where(eq(memberships.id, id));
    await audit(db, { orgId: ctx.orgId, userId: ctx.userId, action: "member.role", entityType: "membership", entityId: id, data: { role } });
  }
  revalidatePath("/settings");
}

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    const input = z.object({ current: z.string().min(1, "Enter your current password"), next: z.string().min(8, "At least 8 characters"), confirm: z.string() }).parse(formObject(formData));
    if (input.next !== input.confirm) return { error: "New passwords do not match" };
    const db = await getDb();
    const { hashPassword } = await import("@/lib/auth/password");
    const [u] = await db.select().from(users).where(eq(users.id, ctx.userId));
    if (!u || !(await verifyPassword(input.current, u.passwordHash))) return { error: "Current password is wrong" };
    await db.update(users).set({ passwordHash: await hashPassword(input.next), updatedAt: new Date() }).where(eq(users.id, u.id));
    await audit(db, { orgId: ctx.orgId, userId: ctx.userId, action: "user.password", entityType: "user", entityId: u.id });
    return { ok: "Password changed." };
  });
}

export async function inviteMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "settings.edit");
    const input = z.object({ email: z.string().email(), name: reqStr, role: z.enum(["owner", "office", "shop", "accountant", "readonly"]), password: z.string().min(8, "At least 8 characters") }).parse(formObject(formData));
    const db = await getDb();
    const [existing] = await db.select().from(users).where(eq(users.email, input.email.trim().toLowerCase()));
    if (!existing) await registerUser(db, { email: input.email, name: input.name, password: input.password });
    await addMember(db, ctx.orgId, input.email, input.role);
    await audit(db, { orgId: ctx.orgId, userId: ctx.userId, action: "member.invite", entityType: "membership", entityId: ctx.orgId, data: { email: input.email, role: input.role } });
    revalidatePath("/settings");
    return { ok: existing ? `${input.email} added as ${input.role}.` : `Account created for ${input.email}; share the temporary password with them.` };
  });
}
