"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { attachments } from "@/lib/db/schema";
import { requireOrg } from "@/lib/tenancy";
import { audit } from "@/lib/audit";
import { formObject, optStr, reqStr, withFormErrors } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";
import { storeFile } from "./storage";

const MAX_BYTES = 25 * 1024 * 1024;

export async function uploadAttachmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    const input = z
      .object({ entityType: reqStr, entityId: reqStr, kind: optStr, revision: optStr, note: optStr, returnTo: optStr })
      .parse(formObject(formData));
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a file first." };
    if (file.size > MAX_BYTES) return { error: "Files are limited to 25 MB." };
    const data = Buffer.from(await file.arrayBuffer());
    const stored = await storeFile(ctx.orgId, file.name, data, file.type || "application/octet-stream");
    const db = await getDb();
    // A new revision of the same file name supersedes the current one.
    await db
      .update(attachments)
      .set({ current: false })
      .where(and(eq(attachments.orgId, ctx.orgId), eq(attachments.entityType, input.entityType), eq(attachments.entityId, input.entityId), eq(attachments.filename, file.name)));
    const [row] = await db
      .insert(attachments)
      .values({
        orgId: ctx.orgId,
        entityType: input.entityType,
        entityId: input.entityId,
        filename: file.name,
        mime: file.type || "application/octet-stream",
        size: stored.size,
        storageKey: stored.key,
        revision: input.revision || "A",
        kind: input.kind || "document",
        note: input.note ?? null,
        uploadedBy: ctx.userId,
      })
      .returning();
    await audit(db, { orgId: ctx.orgId, userId: ctx.userId, action: "attachment.upload", entityType: input.entityType, entityId: input.entityId, data: { attachmentId: row.id, filename: file.name } });
    if (input.returnTo) revalidatePath(input.returnTo);
    revalidatePath("/documents");
    return { ok: `${file.name} uploaded (rev ${row.revision}).` };
  });
}

export async function deleteAttachmentAction(formData: FormData) {
  const ctx = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/documents");
  const db = await getDb();
  await db.delete(attachments).where(and(eq(attachments.id, id), eq(attachments.orgId, ctx.orgId)));
  revalidatePath(returnTo);
}
