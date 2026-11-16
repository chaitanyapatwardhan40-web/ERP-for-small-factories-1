import type { ChecklistItem } from "@/lib/db/schema";
import { Input } from "@/components/ui/fields";

/** Server-rendered checklist rows; names follow results[i][field]. */
export function InspectionChecklist({ checklist }: { checklist: ChecklistItem[] }) {
  if (!checklist.length) return <p className="text-sm text-ink-3">This plan has no checks; the result is pass unless you reject quantity.</p>;
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Check</th>
          <th>Spec</th>
          <th className="w-32">Measured</th>
          <th className="w-20">Pass</th>
        </tr>
      </thead>
      <tbody>
        {checklist.map((c, i) => (
          <tr key={i}>
            <td>
              <input type="hidden" name={`results[${i}][name]`} value={c.name} />
              {c.name}
            </td>
            <td className="text-xs text-ink-3">
              {c.type === "measurement" ? `${c.min ?? ""} – ${c.max ?? ""} ${c.unit ?? ""}` : c.type}
            </td>
            <td>{c.type === "measurement" ? <Input name={`results[${i}][value]`} type="number" step="0.0001" /> : <Input name={`results[${i}][value]`} placeholder="OK / note" />}</td>
            <td className="text-center">
              <input type="checkbox" name={`results[${i}][pass]`} defaultChecked />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
