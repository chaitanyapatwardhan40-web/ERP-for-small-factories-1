"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "@/components/ui/link";
import { askAssistantAction, confirmAssistantAction, type AssistantState } from "@/modules/assistant/actions";

/**
 * The assistant panel: Ctrl/Cmd+K or the button opens a box on every screen.
 * Type what you want; it navigates, answers from live data, or proposes an
 * action that runs only after you confirm it.
 */
export function AssistantPanel({ placeholder }: { placeholder: string }) {
  const pathname = usePathname();
  // The panel is "open" only for the path it was opened on, so navigating
  // away closes it without any state update in an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (v: boolean) => setOpenOn(v ? pathname : null);
  const [ask, askAction, asking] = useActionState<AssistantState, FormData>(askAssistantAction, undefined);
  const [confirm, confirmAction, confirming] = useActionState<AssistantState, FormData>(confirmAssistantAction, undefined);
  const router = useRouter();
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const toast = params.get("assistant");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpenOn((o) => (o === pathname ? null : pathname));
      }
      if (e.key === "Escape") setOpenOn(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathname]);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);
  useEffect(() => {
    if (ask?.result?.type === "navigate") router.push(ask.result.href);
  }, [ask, router]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => router.replace(pathname), 4000);
    return () => clearTimeout(t);
  }, [toast, pathname, router]);

  const result = ask?.result;
  return (
    <>
      {toast ? <div className="no-print fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded bg-ink px-4 py-2 text-sm text-white shadow-lg">{toast}</div> : null}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="no-print fixed bottom-5 right-5 z-30 inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-sm font-medium text-white shadow-lg hover:bg-brand-dark"
        aria-label="Open the assistant"
      >
        Ask
        <kbd className="rounded bg-white/20 px-1 text-[10px] font-normal">⌘K</kbd>
      </button>
      {open ? (
        <div className="no-print fixed inset-0 z-40 flex items-start justify-center bg-ink/30 p-4 pt-[12vh]" onClick={() => setOpen(false)}>
          <div className="w-full max-w-xl rounded-md border border-line bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <form action={askAction} className="flex items-center gap-2 border-b border-line px-3 py-2">
              <input type="hidden" name="pathname" value={pathname} />
              <input
                ref={inputRef}
                name="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={placeholder}
                className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
                autoComplete="off"
              />
              <button type="submit" disabled={asking} className="h-8 rounded bg-brand px-3 text-sm font-medium text-white disabled:opacity-50">
                {asking ? "…" : "Go"}
              </button>
            </form>
            <div className="max-h-[60vh] overflow-y-auto p-3 text-sm">
              {confirm?.error ? <p className="mb-2 rounded border border-bad/30 bg-bad-soft px-3 py-2 text-bad">{confirm.error}</p> : null}
              {confirm?.done ? <p className="mb-2 rounded border border-good/30 bg-good-soft px-3 py-2 text-good">{confirm.done.message}</p> : null}
              {ask?.error ? <p className="rounded border border-bad/30 bg-bad-soft px-3 py-2 text-bad">{ask.error}</p> : null}
              {!result && !ask?.error ? (
                <p className="text-ink-3">Type a request. Navigation and questions run straight away; anything that changes data asks you to confirm first.</p>
              ) : null}
              {result?.type === "help" ? (
                <div>
                  <p className="mb-2 text-ink-2">{result.message}</p>
                  <div className="flex flex-wrap gap-1">
                    {result.suggestions.map((s) => (
                      <button key={s.label} type="button" onClick={() => setDraft(s.text ?? "")} className="rounded-full border border-line bg-paper px-3 py-1 text-xs hover:border-brand">
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {result?.type === "answer" ? (
                <div>
                  <div className="mb-1 font-medium">{result.title}</div>
                  {result.lines?.map((l, i) => (
                    <div key={i} className="text-ink-2">
                      {l}
                    </div>
                  ))}
                  {result.rows?.length ? (
                    <ul className="mt-2 divide-y divide-line rounded border border-line">
                      {result.rows.map((r, i) => (
                        <li key={i} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                          {r.href ? (
                            <Link href={r.href} onClick={() => setOpen(false)} className="font-medium text-brand hover:underline">
                              {r.label}
                            </Link>
                          ) : (
                            <span className="font-medium">{r.label}</span>
                          )}
                          {r.detail ? <span className="text-right text-xs text-ink-3">{r.detail}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {result.href ? (
                    <Link href={result.href} onClick={() => setOpen(false)} className="mt-2 inline-block text-xs text-brand hover:underline">
                      Open the full screen
                    </Link>
                  ) : null}
                </div>
              ) : null}
              {result?.type === "confirm" ? (
                <form action={confirmAction} className="space-y-2">
                  <input type="hidden" name="command" value={result.action.command} />
                  <input type="hidden" name="args" value={JSON.stringify(result.action.args)} />
                  <div className="font-medium">{result.title}</div>
                  <ul className="list-inside list-disc text-ink-2">
                    {result.summary.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                  <div className="flex gap-2 pt-1">
                    <button type="submit" disabled={confirming} className="h-8 rounded bg-brand px-3 text-sm font-medium text-white disabled:opacity-50">
                      {confirming ? "Working…" : "Confirm"}
                    </button>
                    <button type="button" onClick={() => setOpen(false)} className="h-8 rounded border border-line px-3 text-sm">
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
              {result?.type === "done" ? (
                <div>
                  <p className="text-good">{result.message}</p>
                  {result.href ? (
                    <Link href={result.href} onClick={() => setOpen(false)} className="text-xs text-brand hover:underline">
                      Open
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
