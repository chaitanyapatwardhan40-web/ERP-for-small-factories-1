import type { DbOrTx } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";

export async function audit(
  db: DbOrTx,
  input: {
    orgId: string;
    userId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    data?: Record<string, unknown>;
  },
) {
  await db.insert(auditLog).values({
    orgId: input.orgId,
    userId: input.userId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    data: input.data ?? null,
  });
}
