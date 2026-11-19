"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/fields";
import { saveTemplateAction } from "@/modules/books/actions";
import type { TemplateLine } from "@/lib/db/schema";

type Acct = { id: string; code: string; name: string };
type Line = { key: number; accountId: string; debit: string; credit: string; memo: string };

export function TemplateForm({ accounts, template }: { accounts: Acct[]; template?: { id: string; name: string; memo: string | null; frequency: string; nextDate: string | null; lines: TemplateLine[] } }) {
  const [lines, setLines] = useState<Line[]>(
    template?.lines.length
      ? template.lines.map((l, i) => ({ key: i + 1, accountId: l.accountId, debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "", memo: l.memo ?? "" }))
      : [
          { key: 1, accountId: "", debit: "", credit: "", memo: "" },
          { key: 2, accountId: "", debit: "", credit: "", memo: "" },
        ],
  );
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const d = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const c = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.abs(d - c) < 0.005 && d > 0;
  return (
    <ActionForm action={saveTemplateAction} className="space-y-2">
      {template ? <input type="hidden" name="id" value={template.id} /> : null}
      <div className="grid grid-cols-2 gap-2">
        <Input name="name" placeholder="Name (e.g. Monthly depreciation)" defaultValue={template?.name ?? ""} required />
        <Input name="memo" placeholder="Memo on the entry" defaultValue={template?.memo ?? ""} />
        <Select name="frequency" defaultValue={template?.frequency ?? "monthly"}>
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
          <option value="quarterly">Quarterly</option>
          <option value="yearly">Yearly</option>
          <option value="none">On demand</option>
        </Select>
        <Input name="nextDate" type="date" defaultValue={template?.nextDate ?? ""} />
      </div>
      {lines.map((l, i) => (
        <div key={l.key} className="grid grid-cols-[1fr_5rem_5rem] gap-1">
          <select name={`lines[${i}][accountId]`} value={l.accountId} onChange={(e) => update(l.key, { accountId: e.target.value })} className="rounded border border-line bg-white px-2 py-1 text-sm" required>
            <option value="">Account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </select>
          <input name={`lines[${i}][debit]`} type="number" step="0.01" placeholder="Dr" value={l.debit} onChange={(e) => update(l.key, { debit: e.target.value })} className="rounded border border-line px-2 py-1 text-right text-sm" />
          <input name={`lines[${i}][credit]`} type="number" step="0.01" placeholder="Cr" value={l.credit} onChange={(e) => update(l.key, { credit: e.target.value })} className="rounded border border-line px-2 py-1 text-right text-sm" />
        </div>
      ))}
      <div className="flex items-center justify-between text-xs">
        <button type="button" onClick={() => setLines((ls) => [...ls, { key: Date.now(), accountId: "", debit: "", credit: "", memo: "" }])} className="text-brand hover:underline">
          + Add line
        </button>
        <span className={balanced ? "text-good" : "text-ink-3"}>
          Dr {d.toFixed(2)} · Cr {c.toFixed(2)}
        </span>
      </div>
      <SubmitButton variant="secondary" className="w-full">
        {template ? "Save template" : "Create template"}
      </SubmitButton>
    </ActionForm>
  );
}
