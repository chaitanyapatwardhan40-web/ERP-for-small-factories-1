import type { attachments } from "@/lib/db/schema";
import { Card } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/fields";
import { deleteAttachmentAction, uploadAttachmentAction } from "@/modules/documents/actions";
import { fmtDate } from "@/lib/money";

export function AttachmentsCard({ entityType, entityId, rows, returnTo }: { entityType: string; entityId: string; rows: (typeof attachments.$inferSelect)[]; returnTo?: string }) {
  const back = returnTo ?? `/${entityType}s/${entityId}`;
  return (
    <Card title="Documents and drawings">
      {rows.length ? (
        <ul className="mb-3 space-y-1.5 text-sm">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                <a href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" className={`font-medium hover:underline ${a.current ? "text-brand" : "text-ink-3 line-through"}`}>
                  {a.filename}
                </a>{" "}
                <span className="text-xs text-ink-3">
                  rev {a.revision} · {a.kind} · {fmtDate(a.createdAt)}
                </span>
              </span>
              <form action={deleteAttachmentAction}>
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="returnTo" value={back} />
                <button className="text-xs text-ink-3 hover:text-bad" type="submit">
                  delete
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-ink-3">No files yet.</p>
      )}
      <ActionForm action={uploadAttachmentAction} className="space-y-2">
        <input type="hidden" name="entityType" value={entityType} />
        <input type="hidden" name="entityId" value={entityId} />
        <input type="hidden" name="returnTo" value={back} />
        <input name="file" type="file" className="block w-full text-sm" required />
        <div className="flex gap-2">
          <Input name="revision" placeholder="Rev" className="w-20" defaultValue="A" />
          <select name="kind" className="rounded-md border border-line bg-white px-2 py-1.5 text-sm" defaultValue="drawing">
            <option value="drawing">Drawing</option>
            <option value="spec">Spec</option>
            <option value="cert">Cert</option>
            <option value="photo">Photo</option>
            <option value="document">Document</option>
          </select>
          <Input name="note" placeholder="Note" />
        </div>
        <SubmitButton size="sm" variant="secondary">
          Upload
        </SubmitButton>
      </ActionForm>
    </Card>
  );
}
