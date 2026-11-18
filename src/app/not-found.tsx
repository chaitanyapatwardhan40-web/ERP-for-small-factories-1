import Link from "next/link";
import { Wordmark } from "@/components/brand";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mb-5 flex justify-center">
          <Wordmark size={30} />
        </div>
        <div className="rounded-md border border-line bg-white p-6 shadow-xs">
          <p className="text-sm font-medium">Page not found</p>
          <p className="mt-1 text-sm text-ink-3">The record may have been removed, or the link is wrong.</p>
          <Link href="/" className="mt-4 inline-block text-sm text-brand hover:underline">
            Back to Today
          </Link>
        </div>
      </div>
    </div>
  );
}
