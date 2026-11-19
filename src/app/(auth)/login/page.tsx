import Link from "@/components/ui/link";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input } from "@/components/ui/fields";
import { DEMO_LOGIN, showsDemoLogin } from "@/lib/env";
import { loginAction } from "@/modules/platform/actions";

export const metadata = { title: "Sign in" };
// Demo mode is decided by the server environment at request time.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const demo = showsDemoLogin();
  return (
    <ActionForm action={loginAction} className="space-y-4">
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required defaultValue={demo ? DEMO_LOGIN.email : undefined} placeholder="you@company.com" />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required defaultValue={demo ? DEMO_LOGIN.password : undefined} />
      </Field>
      <SubmitButton className="w-full">Sign in</SubmitButton>
      {demo ? (
        <div className="rounded border border-line bg-paper px-3 py-2 text-xs text-ink-2">
          <div className="mb-1 font-medium text-ink">Demo accounts</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <span className="mono">owner@kitwise.demo</span>
            <span>Owner, everything</span>
            <span className="mono">office@kitwise.demo</span>
            <span>Office: sell, buy, make</span>
            <span className="mono">floor@kitwise.demo</span>
            <span>Shop floor and stock</span>
          </div>
          <div className="mt-1">
            Password <span className="mono">kitwise-demo</span> for all three.
          </div>
        </div>
      ) : null}
      <p className="text-center text-sm text-ink-3">
        New here?{" "}
        <Link href="/register" className="text-brand hover:underline">
          Create a workspace
        </Link>
      </p>
    </ActionForm>
  );
}
