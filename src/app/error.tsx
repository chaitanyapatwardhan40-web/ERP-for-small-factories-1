"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm rounded-md border border-line bg-white p-6 text-center shadow-xs">
        <p className="text-sm font-medium">Something went wrong</p>
        <p className="mt-1 text-sm text-ink-3">The page could not be loaded. Nothing was saved.</p>
        {error.digest ? <p className="mt-2 font-mono text-[11px] text-ink-3">Ref {error.digest}</p> : null}
        <button type="button" onClick={reset} className="mt-4 text-sm text-brand hover:underline">
          Try again
        </button>
      </div>
    </div>
  );
}
