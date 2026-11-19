/**
 * Runtime configuration, read from the environment once per call so tests
 * and scripts can change it.
 */

/** Postgres connection string, from DATABASE_URL or the names the Vercel
 *  Neon/Supabase integrations use. Undefined means "embedded database". */
export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || undefined;
}

/**
 * Demo mode runs the app on an in-memory database loaded from a bundled
 * snapshot of the sample company, so it can be deployed with no database at
 * all. It is on when KITWISE_DEMO=1, or automatically on Vercel when no
 * database is configured. KITWISE_DEMO=0 switches it off.
 *
 * Serverless instances do not share memory, so in demo mode each instance
 * has its own copy of the data: sign-in is stateless (a signed cookie) so
 * every instance accepts it, but a record created on one instance is not
 * visible on another. For a persistent demo attach a Postgres database and
 * set KITWISE_SEED=demo.
 */
export function isDemo(): boolean {
  const flag = process.env.KITWISE_DEMO;
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return !!process.env.VERCEL && !databaseUrl();
}

/** KITWISE_SEED=demo loads the sample company into an empty database on first start. */
export function seedsSampleCompany(): boolean {
  return process.env.KITWISE_SEED === "demo";
}

/** Whether the login page should offer the sample company's accounts. */
export function showsDemoLogin(): boolean {
  return isDemo() || seedsSampleCompany();
}

export const DEMO_LOGIN = { email: "owner@kitwise.demo", password: "kitwise-demo" } as const;
