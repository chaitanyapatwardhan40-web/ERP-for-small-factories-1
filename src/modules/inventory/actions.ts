"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireOrg, assertCan } from "@/lib/tenancy";
import { formObject, optStr, reqStr, withFormErrors } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";
import { moveStock, onHand, transferStock } from "./service";
import { round4 } from "@/lib/money";

/** Count / adjust: set the counted quantity and the difference posts. */
export async function adjustStockAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "inventory.edit");
    const input = z
      .object({
        itemId: reqStr,
        locationId: reqStr,
        mode: z.enum(["count", "adjust", "scrap", "receive"]),
        qty: z.coerce.number(),
        unitCost: z.coerce.number().min(0).optional(),
        lotNumber: optStr,
        memo: optStr,
      })
      .parse(formObject(formData));
    const db = await getDb();
    await db.transaction(async (tx) => {
      const here = await onHand(tx, ctx.orgId, input.itemId, input.locationId);
      let delta = input.qty;
      if (input.mode === "count") delta = round4(input.qty - here);
      if (input.mode === "scrap") delta = -Math.abs(input.qty);
      if (input.mode === "receive") delta = Math.abs(input.qty);
      if (delta === 0) throw new Error("No difference to post");
      const type = input.mode === "scrap" ? "scrap" : input.mode === "receive" ? "receipt" : "adjust";
      const glEvent = input.mode === "scrap" ? "inventory.scrap" : delta > 0 ? "inventory.adjust_up" : "inventory.adjust_down";
      await moveStock(tx, {
        orgId: ctx.orgId,
        userId: ctx.userId,
        itemId: input.itemId,
        locationId: input.locationId,
        qty: delta,
        type,
        unitCost: delta > 0 ? input.unitCost : undefined,
        lotNumber: input.lotNumber ?? null,
        refType: input.mode,
        memo: input.memo ?? (input.mode === "count" ? `Count: ${input.qty} found, ${here} on book` : undefined),
        glEvent,
        allowNegative: input.mode === "adjust",
      });
    });
    revalidatePath(`/items/${input.itemId}`);
    revalidatePath("/inventory");
    return { ok: "Posted." };
  });
}

export async function transferStockAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "inventory.edit");
    const input = z.object({ itemId: reqStr, fromLocationId: reqStr, toLocationId: reqStr, qty: z.coerce.number().positive(), lotNumber: optStr, memo: optStr }).parse(formObject(formData));
    if (input.fromLocationId === input.toLocationId) return { error: "Pick two different locations" };
    const db = await getDb();
    await db.transaction((tx) => transferStock(tx, { ...input, orgId: ctx.orgId, userId: ctx.userId, lotNumber: input.lotNumber ?? null }));
    revalidatePath(`/items/${input.itemId}`);
    revalidatePath("/inventory");
    return { ok: "Moved." };
  });
}
