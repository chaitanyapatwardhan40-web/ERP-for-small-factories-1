"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireOrg } from "@/lib/tenancy";
import { errorMessage } from "@/lib/forms";
import { execute, interpret, type AssistantResult } from "./service";

export type AssistantState = { text?: string; result?: AssistantResult; error?: string; done?: { message: string; href?: string } } | undefined;

export async function askAssistantAction(_prev: AssistantState, formData: FormData): Promise<AssistantState> {
  const text = String(formData.get("text") ?? "");
  const pathname = String(formData.get("pathname") ?? "/");
  try {
    const ctx = await requireOrg();
    const db = await getDb();
    const result = await interpret(db, ctx, text, { pathname });
    return { text, result };
  } catch (e) {
    return { text, error: errorMessage(e) };
  }
}

export async function confirmAssistantAction(_prev: AssistantState, formData: FormData): Promise<AssistantState> {
  const command = String(formData.get("command") ?? "");
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(String(formData.get("args") ?? "{}"));
  } catch {
    return { error: "Bad request" };
  }
  let done: { message: string; href?: string };
  try {
    const ctx = await requireOrg();
    const db = await getDb();
    done = await db.transaction((tx) => execute(tx, ctx, command, args));
  } catch (e) {
    return { error: errorMessage(e) };
  }
  if (done.href) redirect(`${done.href}${done.href.includes("?") ? "&" : "?"}assistant=${encodeURIComponent(done.message)}`);
  return { done };
}
