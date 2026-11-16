export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-lg font-bold text-white">K</div>
          <h1 className="text-lg font-semibold">Kitwise</h1>
          <p className="text-sm text-ink-3">Quote, make, buy, ship, bill. One system for the shop.</p>
        </div>
        <div className="rounded-lg border border-line bg-white p-6 shadow-xs">{children}</div>
      </div>
    </div>
  );
}
