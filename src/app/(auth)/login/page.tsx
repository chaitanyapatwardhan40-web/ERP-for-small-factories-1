import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input } from "@/components/ui/fields";
import { loginAction } from "@/modules/platform/actions";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <ActionForm action={loginAction} className="space-y-4">
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required placeholder="you@shop.com" />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton className="w-full">Sign in</SubmitButton>
      <p className="text-center text-sm text-ink-3">
        New here?{" "}
        <Link href="/register" className="text-brand hover:underline">
          Create your shop
        </Link>
      </p>
      <p className="rounded-md bg-paper px-3 py-2 text-center text-xs text-ink-3">
        Demo: <span className="font-mono">owner@kitwise.demo</span> / <span className="font-mono">kitwise-demo</span> after running{" "}
        <span className="font-mono">npm run db:seed</span>
      </p>
    </ActionForm>
  );
}
