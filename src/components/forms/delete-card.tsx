import { ActionForm, SubmitButton, type FormAction } from "@/components/ui/form";

/**
 * A folded-away delete: one click to open, a second to confirm. Only shown
 * on records the service will actually let go of (drafts and cancellations
 * with nothing downstream); anything else is cancelled or closed instead.
 */
export function DeleteCard({ action, id, label, note }: { action: FormAction; id: string; label: string; note?: string }) {
  return (
    <details className="rounded-md border border-line bg-white shadow-xs">
      <summary className="cursor-pointer select-none px-4 py-2.5 text-sm text-ink-2 hover:text-ink">Delete {label}…</summary>
      <div className="border-t border-line p-4">
        <p className="mb-3 text-sm text-ink-2">{note ?? "Removes it for good. The audit log keeps the number and who deleted it."}</p>
        <ActionForm action={action}>
          <input type="hidden" name="id" value={id} />
          <SubmitButton variant="danger" className="w-full">
            Delete {label}
          </SubmitButton>
        </ActionForm>
      </div>
    </details>
  );
}
