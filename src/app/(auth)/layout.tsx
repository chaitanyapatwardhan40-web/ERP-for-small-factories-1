import { Wordmark } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex justify-center">
          <Wordmark size={30} />
        </div>
        <div className="rounded border border-line bg-white p-6 shadow-xs">{children}</div>
      </div>
    </div>
  );
}
