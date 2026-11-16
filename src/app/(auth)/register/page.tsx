import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input } from "@/components/ui/fields";
import { registerAction } from "@/modules/platform/actions";

export const metadata = { title: "Create your shop" };

export default function RegisterPage() {
  return (
    <ActionForm action={registerAction} className="space-y-4">
      <Field label="Shop name">
        <Input name="shopName" required placeholder="Acme Precision LLC" />
      </Field>
      <Field label="Your name">
        <Input name="name" required autoComplete="name" />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" required autoComplete="email" />
      </Field>
      <Field label="Password" hint="At least 8 characters">
        <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
      </Field>
      <SubmitButton className="w-full">Create shop</SubmitButton>
      <p className="text-center text-sm text-ink-3">
        Already have an account?{" "}
        <Link href="/login" className="text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </ActionForm>
  );
}
