"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/fields";
import { postJournalAction } from "@/modules/books/actions";

type Acct = { id: string; code: string; name: string };
type Line = { key: number; accountId: string; debit: string; credit: string };

export function JournalForm({ accounts, defaultDate }: { accounts: Acct[]; defaultDate: string }) {
  const [lines, setLines] = useState<Line[]>([
    { key: 1, accountId: "", debit: "", credit: "" },
    { key: 2, accountId: "", debit: "", credit: "" },
  ]);
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const d = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const c = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.abs(d - c) < 0.005 && d > 0;
  return (
    <ActionForm action={postJournalAction} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Input name="date" type="date" defaultValue={defaultDate} required />
        <Input name="memo" placeholder="Memo" required />
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
        <button type="button" className="text-brand hover:underline" onClick={() => setLines((ls) => [...ls, { key: Date.now(), accountId: "", debit: "", credit: "" }])}>
          + line
        </button>
        <span className={balanced ? "text-good" : "text-ink-3"}>
          Dr {d.toFixed(2)} · Cr {c.toFixed(2)} {balanced ? "· balanced" : ""}
        </span>
      </div>
      <SubmitButton className="w-full" variant="secondary">
        Post entry
      </SubmitButton>
    </ActionForm>
  );
}
