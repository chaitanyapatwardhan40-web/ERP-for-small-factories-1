import { Input, Select } from "@/components/ui/fields";
import { Button } from "@/components/ui/button";

/**
 * Filter bar for list screens: a GET form so filters live in the URL and can
 * be bookmarked, plus a CSV export of the same filtered rows.
 */
export function ListToolbar({
  action,
  q,
  filters,
  exportKind,
  params,
}: {
  action: string;
  q?: string;
  filters?: { name: string; value?: string; options: { value: string; label: string }[] }[];
  exportKind?: string;
  params?: Record<string, string | undefined>;
}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v) query.set(k, v);
  if (exportKind) query.set("kind", exportKind);
  return (
    <div className="no-print mb-3 flex flex-wrap items-center gap-2">
      <form action={action} method="get" className="flex flex-wrap items-center gap-2">
        {filters?.map((f) => (
          <Select key={f.name} name={f.name} defaultValue={f.value ?? ""} className="w-auto">
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ))}
        <Input name="q" defaultValue={q ?? ""} placeholder="Search" className="w-56" />
        <Button type="submit" variant="secondary" size="sm">
          Filter
        </Button>
      </form>
      {exportKind ? (
        <a href={`/api/export?${query.toString()}`} className="ml-auto text-sm text-brand hover:underline">
          Export CSV
        </a>
      ) : null}
    </div>
  );
}
