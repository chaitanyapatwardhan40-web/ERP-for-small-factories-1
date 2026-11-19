"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "@/components/ui/link";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/fields";
import { ENTITIES, type EntityKind } from "@/modules/importer/mapping";
import { confirmImportAction, previewImportAction, type PreviewState } from "@/modules/importer/actions";

function Pending({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Working…" : children}
    </Button>
  );
}

/** Step 1 upload → step 2 map and confirm → step 3 result. One screen, three states. */
export function ImportWizard({ aiEnabled }: { aiEnabled: boolean }) {
  const [state, preview] = useActionState(previewImportAction, {} as PreviewState);
  const [done, confirm] = useActionState(confirmImportAction, {} as PreviewState);
  const p = state?.preview;
  const kinds = Object.keys(ENTITIES) as EntityKind[];

  if (done?.result) {
    const r = done.result;
    return (
      <div className="space-y-3">
        <div className="rounded border border-good/30 bg-good-soft px-4 py-3 text-sm text-good">
          <strong>{ENTITIES[r.kind].label}:</strong> {r.created} created, {r.updated} updated, {r.skipped} skipped{r.errors.length ? `, ${r.errors.length} rows with problems` : ""}.
        </div>
        {r.errors.length ? (
          <ul className="list-inside list-disc text-sm text-bad">
            {r.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex gap-2 text-sm">
          <Link href="/import" className="text-brand hover:underline">
            Import another file
          </Link>
          <Link href={r.kind === "customers" ? "/customers" : r.kind === "vendors" ? "/vendors" : r.kind === "employees" ? "/people" : r.kind === "work_centers" ? "/items/work-centers" : "/items"} className="text-brand hover:underline">
            See the records
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form action={preview} className="flex flex-wrap items-end gap-3 rounded border border-dashed border-line bg-white p-4">
        <div>
          <span className="mb-1 block text-xs font-medium text-ink-2">Spreadsheet (.xlsx, .xls, .csv)</span>
          <input name="file" type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm" className="text-sm" required={!p} />
        </div>
        <Pending>Read file</Pending>
        <span className="text-xs text-ink-3">{aiEnabled ? "Columns are mapped from the headers and sample rows." : "Columns are mapped from the header names."}</span>
      </form>
      {state?.error ? <div className="rounded border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</div> : null}
      {done?.error ? <div className="rounded border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{done.error}</div> : null}
      {p ? (
        <form action={confirm} className="space-y-4">
          <input type="hidden" name="payload" value={p.payload} />
          <input type="hidden" name="sheetIndex" value={p.sheetIndex} />
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <span className="mb-1 block text-xs font-medium text-ink-2">This looks like</span>
              <Select name="kind" defaultValue={p.kind} form="rekind">
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {ENTITIES[k].label}
                  </option>
                ))}
              </Select>
            </div>
            {p.sheets.length > 1 ? (
              <div>
                <span className="mb-1 block text-xs font-medium text-ink-2">Sheet</span>
                <Select name="sheetIndex" defaultValue={String(p.sheetIndex)} form="rekind">
                  {p.sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name} ({s.rowCount} rows)
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <Button type="submit" form="rekind" variant="secondary">
              Re-map
            </Button>
            <span className="text-sm text-ink-3">
              {p.filename} · {p.rowCount} rows{p.aiModel ? ` · mapped with ${p.aiModel}` : " · mapped by header matching"}
            </span>
          </div>
          <input type="hidden" name="kind" value={p.kind} />
          <p className="text-xs text-ink-3">{ENTITIES[p.kind].hint}</p>
          {p.notes.length ? (
            <ul className="list-inside list-disc rounded border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
              {p.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
          <table className="data">
            <thead>
              <tr>
                <th>Field</th>
                <th>Column in your file</th>
                <th>Sample values</th>
              </tr>
            </thead>
            <tbody>
              {ENTITIES[p.kind].fields.map((f) => {
                const h = p.mapping[f.key];
                return (
                  <tr key={f.key}>
                    <td className={f.required ? "font-medium" : ""}>
                      {f.label}
                      {f.required ? <span className="text-bad"> *</span> : null}
                    </td>
                    <td>
                      <select name={`map[${f.key}]`} defaultValue={h ?? ""} className="w-full rounded border border-line bg-white px-2 py-1 text-sm">
                        <option value="">— not in file —</option>
                        {p.headers.map((hh) => (
                          <option key={hh} value={hh}>
                            {hh}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-xs text-ink-3">{h ? p.sample.map((r) => r[h]).filter(Boolean).slice(0, 3).join(" · ") : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center gap-3">
            <Pending>{`Import ${p.rowCount} rows`}</Pending>
            <span className="text-xs text-ink-3">Rows with an existing code or SKU update that record.</span>
          </div>
        </form>
      ) : null}
      {p ? (
        <form id="rekind" action={preview}>
          <input type="hidden" name="payload" value={p.payload} />
          <input type="hidden" name="filename" value={p.filename} />
        </form>
      ) : null}
    </div>
  );
}
