import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, FormGrid, Input } from "@/components/ui/fields";
import { createOrgAction } from "@/modules/platform/actions";

export const metadata = { title: "Set up your company" };

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <ActionForm action={createOrgAction} className="space-y-4">
      <p className="text-sm text-ink-2">Name your company. Locations, a chart of accounts and posting rules are created for you.</p>
      <Field label="Company name">
        <Input name="shopName" required placeholder="Northline Kitting & Assembly" />
      </Field>
      <FormGrid>
        <Field label="Overhead % of labour" hint="Applied to work orders at completion">
          <Input name="overheadPct" type="number" step="0.1" defaultValue={25} />
        </Field>
        <Field label="Default sales tax %">
          <Input name="taxRatePct" type="number" step="0.01" defaultValue={0} />
        </Field>
      </FormGrid>
      <SubmitButton className="w-full">Continue</SubmitButton>
    </ActionForm>
  );
}
