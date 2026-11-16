import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` reads the schema and writes SQL migrations to ./drizzle.
// `drizzle-kit migrate` applies them to DATABASE_URL (production / staging).
// In development and tests the app applies the same folder to PGlite itself
// (see src/lib/db/index.ts), so no local Postgres is needed.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/kitwise",
  },
  strict: true,
  verbose: true,
});
