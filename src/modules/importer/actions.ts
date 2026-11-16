"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireOrg, assertCan } from "@/lib/tenancy";
import { audit } from "@/lib/audit";
import { formObject, optStr, reqStr, withFormErrors } from "@/lib/forms";
import type { ActionState } from "@/components/ui/form";
import { ENTITIES, guessEntity, heuristicMapping, type EntityKind, type Mapping } from "./mapping";
import { parseSpreadsheet, type Sheet } from "./parse";
import { adviseWithClaude } from "./ai";
import { runImport, type ImportResult } from "./service";

export type PreviewState = NonNullable<ActionState> & {
  preview?: {
    filename: string;
    sheets: { name: string; rowCount: number }[];
    sheetIndex: number;
    headers: string[];
    sample: Record<string, string>[];
    rowCount: number;
    kind: EntityKind;
    mapping: Mapping;
    notes: string[];
    aiModel?: string;
    payload: string; // base64 JSON of the sheet rows, carried through the confirm form
  };
  result?: ImportResult & { kind: EntityKind };
};

export async function previewImportAction(_prev: PreviewState, formData: FormData): Promise<PreviewState> {
  const out = await withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "master.edit");
    const file = formData.get("file");
    const sheetIndex = Number(formData.get("sheetIndex") ?? 0) || 0;
    const forcedKind = String(formData.get("kind") ?? "") as EntityKind | "";
    let sheets: Sheet[];
    let filename: string;
    if (file instanceof File && file.size > 0) {
      filename = file.name;
      sheets = parseSpreadsheet(file.name, Buffer.from(await file.arrayBuffer()));
    } else {
      // Re-run on an already parsed payload (user changed the sheet or the kind).
      const payload = String(formData.get("payload") ?? "");
      filename = String(formData.get("filename") ?? "sheet");
      if (!payload) return { error: "Choose a file first." };
      sheets = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as Sheet[];
    }
    const sheet = sheets[Math.min(sheetIndex, sheets.length - 1)];
    if (!sheet || !sheet.headers.length) return { error: "Could not find a header row in that sheet." };
    const guess = (forcedKind && forcedKind in ENTITIES ? forcedKind : guessEntity(sheet.headers, sheet.rows)) as EntityKind;
    let mapping = heuristicMapping(guess, sheet.headers);
    let kind = guess;
    let notes: string[] = [];
    let aiModel: string | undefined;
    if (!forcedKind) {
      const ai = await adviseWithClaude(sheet.headers, sheet.rows.slice(0, 5), guess);
      if (ai) {
        kind = ai.kind;
        mapping = { ...heuristicMapping(ai.kind, sheet.headers), ...Object.fromEntries(Object.entries(ai.mapping).filter(([, v]) => v)) };
        notes = ai.notes;
        aiModel = ai.model;
      }
    }
    const def = ENTITIES[kind];
    const missing = def.fields.filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
    if (missing.length) notes = [`Still needs a column for: ${missing.join(", ")}.`, ...notes];
    return {
      preview: {
        filename,
        sheets: sheets.map((s) => ({ name: s.name, rowCount: s.rows.length })),
        sheetIndex: Math.min(sheetIndex, sheets.length - 1),
        headers: sheet.headers,
        sample: sheet.rows.slice(0, 5),
        rowCount: sheet.rows.length,
        kind,
        mapping,
        notes,
        aiModel,
        payload: Buffer.from(JSON.stringify(sheets)).toString("base64"),
      },
    } satisfies PreviewState;
  });
  return out as PreviewState;
}

export async function confirmImportAction(_prev: PreviewState, formData: FormData): Promise<PreviewState> {
  const out = await withFormErrors(async () => {
    const ctx = await requireOrg();
    assertCan(ctx, "master.edit");
    const head = z.object({ kind: reqStr, payload: reqStr, sheetIndex: optStr }).parse(formObject(formData));
    const kind = head.kind as EntityKind;
    if (!(kind in ENTITIES)) return { error: "Unknown sheet kind" };
    const sheets = JSON.parse(Buffer.from(head.payload, "base64").toString("utf8")) as Sheet[];
    const sheet = sheets[Number(head.sheetIndex ?? 0) || 0];
    const mapping: Mapping = {};
    for (const f of ENTITIES[kind].fields) {
      const v = String(formData.get(`map[${f.key}]`) ?? "");
      mapping[f.key] = v && sheet.headers.includes(v) ? v : null;
    }
    const db = await getDb();
    const result = await db.transaction((tx) => runImport(tx, ctx, kind, mapping, sheet.rows));
    await audit(db, { orgId: ctx.orgId, userId: ctx.userId, action: "import.run", entityType: "import", data: { kind, ...result, errors: result.errors.slice(0, 10) } });
    revalidatePath("/items");
    revalidatePath("/customers");
    revalidatePath("/vendors");
    revalidatePath("/inventory");
    return { result: { ...result, kind } } satisfies PreviewState;
  });
  return out as PreviewState;
}
