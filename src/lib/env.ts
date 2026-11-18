/**
 * Demo mode runs the app on an in-memory database loaded from a bundled
 * snapshot of the sample shop, so it can be deployed with no database at
 * all. It is on when KITWISE_DEMO=1, or automatically on Vercel when no
 * DATABASE_URL is configured. KITWISE_DEMO=0 switches it off.
 */
export function isDemo(): boolean {
  const flag = process.env.KITWISE_DEMO;
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return !!process.env.VERCEL && !process.env.DATABASE_URL;
}

export const DEMO_LOGIN = { email: "owner@kitwise.demo", password: "kitwise-demo" } as const;
