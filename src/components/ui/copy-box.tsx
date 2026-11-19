"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Read-only text with a copy button, for email drafts the shop sends itself. */
export function CopyBox({ subject, body, mailto }: { subject?: string; body: string; mailto?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(subject ? `Subject: ${subject}\n\n${body}` : body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  const href = mailto ? `mailto:${mailto}?subject=${encodeURIComponent(subject ?? "")}&body=${encodeURIComponent(body)}` : undefined;
  return (
    <div className="space-y-2">
      {subject ? <div className="text-sm font-medium">{subject}</div> : null}
      <textarea readOnly value={body} className="h-44 w-full rounded border border-line bg-paper px-3 py-2 font-mono text-xs" />
      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
        {href ? (
          <a href={href} className="inline-flex h-8 items-center rounded border border-line bg-white px-3 text-sm hover:bg-paper">
            Open in mail
          </a>
        ) : null}
      </div>
    </div>
  );
}
