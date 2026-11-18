export function Mark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="7" fill="currentColor" />
      <path d="M10.5 8v16M13 16l8.5-8M13 16l8.5 8" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Mark size={size} className="text-brand" />
      <span className="text-[15px] font-semibold tracking-tight text-ink">Kitwise</span>
    </span>
  );
}
