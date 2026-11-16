"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "./button";

export type ActionState = { error?: string; ok?: string } | undefined;
export type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * A form bound to a server action that returns { error } on failure and
 * redirects on success. Keeps every business form uncontrolled and simple.
 */
export function ActionForm({
  action,
  children,
  className = "",
  initial,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  initial?: ActionState;
}) {
  const [state, formAction] = useActionState(action, initial);
  return (
    <form action={formAction} className={className}>
      {state?.error ? (
        <div className="mb-4 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</div>
      ) : null}
      {state?.ok ? (
        <div className="mb-4 rounded-md border border-good/30 bg-good-soft px-3 py-2 text-sm text-good">{state.ok}</div>
      ) : null}
      {children}
    </form>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className = "",
  name,
  value,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} className={className} disabled={pending} name={name} value={value}>
      {pending ? "Working…" : children}
    </Button>
  );
}
