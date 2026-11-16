import { asc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { locations } from "@/lib/db/schema";
import { Card, PageHeader, Tabs, Badge } from "@/components/ui/page";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input, Select } from "@/components/ui/fields";
import { saveLocationAction } from "@/modules/items/actions";
import { ITEM_TABS } from "../tabs";

export const metadata = { title: "Locations" };

export default async function LocationsPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const rows = await db.select().from(locations).where(eq(locations.orgId, ctx.orgId)).orderBy(asc(locations.code));
  return (
    <>
      <PageHeader title="Stock locations" description="Where stock lives: racks, the floor, the shipping dock, quarantine." />
      <Tabs tabs={ITEM_TABS} current="/items/locations" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card padded={false} className="lg:col-span-2">
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Type</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td className="font-mono text-xs">{l.code}</td>
                  <td>{l.name}</td>
                  <td>{l.type}</td>
                  <td>{l.active ? null : <Badge tone="bad">inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Add location">
          <ActionForm action={saveLocationAction} className="space-y-3">
            <FormGrid cols={2}>
              <Field label="Code">
                <Input name="code" required placeholder="RACK-A" />
              </Field>
              <Field label="Name">
                <Input name="name" required />
              </Field>
              <Field label="Type">
                <Select name="type" defaultValue="stock">
                  <option value="stock">Stock</option>
                  <option value="wip">WIP / floor</option>
                  <option value="staging">Staging</option>
                  <option value="shipping">Shipping</option>
                  <option value="quarantine">Quarantine</option>
                </Select>
              </Field>
            </FormGrid>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
