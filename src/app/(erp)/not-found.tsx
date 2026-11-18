import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-sm rounded-md border border-line bg-white p-6 text-center shadow-xs">
      <p className="text-sm font-medium">Record not found</p>
      <p className="mt-1 text-sm text-ink-3">It may have been removed, or the link is wrong.</p>
      <Link href="/" className="mt-4 inline-block text-sm text-brand hover:underline">
        Back to Today
      </Link>
    </div>
  );
}
