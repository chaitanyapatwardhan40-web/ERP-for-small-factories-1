import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select } from "@/components/ui/fields";
import { Card } from "@/components/ui/page";
import { addActivityAction, addContactAction } from "@/modules/parties/actions";
import { fmtDateTime } from "@/lib/money";
import type { activities, contacts } from "@/lib/db/schema";

export function ContactsCard({ partyType, partyId, rows }: { partyType: "customer" | "vendor" | "lead"; partyId: string; rows: (typeof contacts.$inferSelect)[] }) {
  return (
    <Card title="Contacts">
      {rows.length ? (
        <ul className="mb-3 space-y-1 text-sm">
          {rows.map((c) => (
            <li key={c.id}>
              <span className="font-medium">{c.name}</span>
              {c.title ? <span className="text-ink-3"> · {c.title}</span> : null}
              {c.email ? <span className="text-ink-3"> · {c.email}</span> : null}
              {c.phone ? <span className="text-ink-3"> · {c.phone}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-ink-3">No contacts yet.</p>
      )}
      <ActionForm action={addContactAction} className="grid grid-cols-2 gap-2">
        <input type="hidden" name="partyType" value={partyType} />
        <input type="hidden" name="partyId" value={partyId} />
        <Input name="name" placeholder="Name" required />
        <Input name="title" placeholder="Title" />
        <Input name="email" placeholder="Email" type="email" />
        <Input name="phone" placeholder="Phone" />
        <div className="col-span-2">
          <SubmitButton size="sm" variant="secondary">
            Add contact
          </SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}

export function ActivityCard({ partyType, partyId, rows }: { partyType: "customer" | "vendor" | "lead"; partyId: string; rows: (typeof activities.$inferSelect)[] }) {
  return (
    <Card title="Activity">
      <ActionForm action={addActivityAction} className="mb-3 flex gap-2">
        <input type="hidden" name="partyType" value={partyType} />
        <input type="hidden" name="partyId" value={partyId} />
        <Select name="type" className="w-28" defaultValue="note">
          <option value="note">Note</option>
          <option value="call">Call</option>
          <option value="email">Email</option>
          <option value="meeting">Meeting</option>
          <option value="visit">Visit</option>
        </Select>
        <Input name="summary" placeholder="What happened?" required />
        <SubmitButton size="md" variant="secondary">
          Log
        </SubmitButton>
      </ActionForm>
      {rows.length ? (
        <ul className="space-y-2 text-sm">
          {rows.map((a) => (
            <li key={a.id} className="border-l-2 border-line pl-3">
              <div className="text-xs text-ink-3">
                {fmtDateTime(a.at)} · {a.type}
              </div>
              <div>{a.summary}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">Nothing logged yet.</p>
      )}
    </Card>
  );
}

export function QuickField({ label, name, defaultValue, type = "text" }: { label: string; name: string; defaultValue?: string | number; type?: string }) {
  return (
    <Field label={label}>
      <Input name={name} type={type} defaultValue={defaultValue} />
    </Field>
  );
}
