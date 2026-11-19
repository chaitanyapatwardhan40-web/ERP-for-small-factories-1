import { desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/tenancy";
import { getDb } from "@/lib/db";
import { capas, items, ncrs, vendors } from "@/lib/db/schema";
import { pickItems, pickVendors } from "@/lib/pick";
import { Card, PageHeader, Tabs, StatusBadge } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/fields";
import { addCapaAction, capaStatusAction, dispositionNcrAction, openNcrAction } from "@/modules/quality/actions";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/money";
import { QUALITY_TABS } from "../tabs";

export const metadata = { title: "NCRs and CAPAs" };

export default async function NcrsPage() {
  const ctx = await requireOrg();
  const db = await getDb();
  const [rows, capaRows, itemList, vendorList] = await Promise.all([
    db.select({ n: ncrs, sku: items.sku, vendorName: vendors.name }).from(ncrs).leftJoin(items, eq(items.id, ncrs.itemId)).leftJoin(vendors, eq(vendors.id, ncrs.vendorId)).where(eq(ncrs.orgId, ctx.orgId)).orderBy(desc(ncrs.createdAt)),
    db.select({ c: capas, ncrNumber: ncrs.number }).from(capas).leftJoin(ncrs, eq(ncrs.id, capas.ncrId)).where(eq(capas.orgId, ctx.orgId)).orderBy(desc(capas.createdAt)),
    pickItems(db, ctx.orgId),
    pickVendors(db, ctx.orgId),
  ]);
  return (
    <>
      <PageHeader title="Non-conformances and corrective actions" description={`${rows.filter((r) => r.n.status === "open").length} open NCRs · ${capaRows.filter((c) => c.c.status !== "closed").length} open CAPAs`} />
      <Tabs tabs={QUALITY_TABS} current="/quality/ncrs" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="NCRs" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>NCR</th>
                  <th>Source</th>
                  <th>Item / vendor</th>
                  <th className="num">Qty</th>
                  <th>Description</th>
                  <th>Disposition</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ n, sku, vendorName }) => (
                  <tr key={n.id}>
                    <td>
                      <div className="font-mono text-xs">{n.number}</div>
                      <StatusBadge status={n.status} />
                      <div className="text-xs text-ink-3">{fmtDate(n.createdAt)}</div>
                    </td>
                    <td>{n.source.replace("_", " ")}</td>
                    <td>
                      {sku}
                      {vendorName ? <div className="text-xs text-ink-3">{vendorName}</div> : null}
                    </td>
                    <td className="num">{fmtQty(n.qty)}</td>
                    <td className="max-w-xs text-xs">{n.description}</td>
                    <td>
                      {n.status === "open" ? (
                        <ActionForm action={dispositionNcrAction} className="flex flex-col gap-1">
                          <input type="hidden" name="id" value={n.id} />
                          <Select name="disposition" defaultValue={n.disposition}>
                            <option value="pending">pending</option>
                            <option value="use_as_is">use as is</option>
                            <option value="rework">rework</option>
                            <option value="scrap">scrap</option>
                            <option value="return_to_vendor">return to vendor</option>
                          </Select>
                          <Input name="rootCause" placeholder="Root cause" defaultValue={n.rootCause ?? ""} />
                          <Input name="containment" placeholder="Containment (sorted, quarantined…)" defaultValue={n.containment ?? ""} />
                          <div className="flex gap-1">
                            <Input name="cost" type="number" step="0.01" placeholder="Cost $" defaultValue={Number(n.cost) ? String(n.cost) : ""} />
                            <Input name="customerRef" placeholder="Customer ref" defaultValue={n.customerRef ?? ""} />
                          </div>
                          <label className="flex items-center gap-1 text-xs">
                            <input type="checkbox" name="close" /> close
                          </label>
                          <SubmitButton size="sm" variant="secondary">
                            Save
                          </SubmitButton>
                        </ActionForm>
                      ) : (
                        <div className="text-xs">
                          <div>{n.disposition.replaceAll("_", " ")}</div>
                          {n.rootCause ? <div className="text-ink-3">Cause: {n.rootCause}</div> : null}
                          {n.containment ? <div className="text-ink-3">Containment: {n.containment}</div> : null}
                          {Number(n.cost) ? <div className="text-ink-3">Cost {fmtMoney(n.cost)}</div> : null}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={6} className="text-ink-3">
                      No non-conformances. Failed inspections open one automatically.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
          <Card title="Corrective actions (CAPA)" padded={false}>
            <table className="data">
              <thead>
                <tr>
                  <th>CAPA</th>
                  <th>NCR</th>
                  <th>Root cause</th>
                  <th>Action</th>
                  <th>Owner</th>
                  <th>Due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {capaRows.map(({ c, ncrNumber }) => (
                  <tr key={c.id}>
                    <td className="font-mono text-xs">{c.number}</td>
                    <td className="font-mono text-xs">{ncrNumber}</td>
                    <td className="text-xs">{c.rootCause}</td>
                    <td className="text-xs">
                      {c.correctiveAction}
                      {c.preventiveAction ? <div className="text-ink-3">Prevent: {c.preventiveAction}</div> : null}
                    </td>
                    <td>{c.owner}</td>
                    <td>
                      {fmtDate(c.dueDate)}
                      {c.effectivenessCheckAt ? <div className="text-xs text-ink-3">check {fmtDate(c.effectivenessCheckAt)}</div> : null}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <StatusBadge status={c.status} />
                        {c.effective === true ? <span className="text-xs text-good">effective</span> : c.effective === false ? <span className="text-xs text-bad">not effective</span> : null}
                        {c.status !== "closed" ? (
                          <form action={capaStatusAction} className="flex items-center gap-1">
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="status" value={c.status === "open" ? "verified" : "closed"} />
                            {c.status === "verified" ? (
                              <Select name="effective" defaultValue="yes" className="w-auto text-xs">
                                <option value="yes">effective</option>
                                <option value="no">not effective</option>
                              </Select>
                            ) : null}
                            <Button type="submit" size="sm" variant="ghost">
                              {c.status === "open" ? "verify" : "close"}
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {!capaRows.length ? (
                  <tr>
                    <td colSpan={7} className="text-ink-3">
                      No corrective actions yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Open an NCR">
            <ActionForm action={openNcrAction} className="space-y-2">
              <Select name="source" defaultValue="in_process">
                <option value="incoming">Incoming (vendor)</option>
                <option value="in_process">In process</option>
                <option value="final">Final</option>
                <option value="customer">Customer return / complaint</option>
              </Select>
              <Select name="itemId" defaultValue="">
                <option value="">Item…</option>
                {itemList.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.sku}
                  </option>
                ))}
              </Select>
              <Select name="vendorId" defaultValue="">
                <option value="">Vendor (if incoming)…</option>
                {vendorList.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
              <Input name="qty" type="number" step="1" placeholder="Qty affected" />
              <Textarea name="description" placeholder="What is wrong" required className="min-h-16" />
              <SubmitButton className="w-full">Open NCR</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Add a corrective action">
            <ActionForm action={addCapaAction} className="space-y-2">
              <Select name="ncrId" defaultValue="">
                <option value="">Link to NCR (optional)</option>
                {rows.map(({ n }) => (
                  <option key={n.id} value={n.id}>
                    {n.number}
                  </option>
                ))}
              </Select>
              <Input name="rootCause" placeholder="Root cause" />
              <Textarea name="correctiveAction" placeholder="Corrective action (fix this occurrence)" required className="min-h-16" />
              <Textarea name="preventiveAction" placeholder="Preventive action (stop it recurring)" className="min-h-12" />
              <div className="grid grid-cols-3 gap-2">
                <Input name="owner" placeholder="Owner" />
                <Input name="dueDate" type="date" title="Due" />
                <Input name="effectivenessCheckAt" type="date" title="Effectiveness check" />
              </div>
              <p className="text-xs text-ink-3">Dates: due, then effectiveness check.</p>
              <SubmitButton variant="secondary" className="w-full">
                Open CAPA
              </SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
