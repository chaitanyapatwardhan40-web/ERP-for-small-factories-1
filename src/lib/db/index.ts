import path from "node:path";
import fs from "node:fs";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "./schema";

export type Schema = typeof schema;
/** Either driver (PGlite in dev/test, postgres-js in production). */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Anything that can run queries: the database or an open transaction. */
export type DbOrTx = Db | Tx;

const MIGRATIONS = path.join(process.cwd(), "drizzle");

type Holder = { db?: Db; ready?: Promise<Db> };
const holder: Holder = ((globalThis as unknown as { __kitwiseDb?: Holder }).__kitwiseDb ??= {});

async function createDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    const client = postgres(url, { max: 5, prepare: false });
    const db = drizzle({ client, schema });
    return db as unknown as Db;
  }
  // Embedded Postgres (WASM). Data lives in ./.data/pglite; tests use memory.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite");
  if (dataDir !== "memory://") fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir === "memory://" ? undefined : dataDir);
  await client.waitReady;
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as Db;
}

/** The application database. Cached across hot reloads. */
export function getDb(): Promise<Db> {
  if (holder.db) return Promise.resolve(holder.db);
  holder.ready ??= createDb().then((db) => {
    holder.db = db;
    return db;
  });
  return holder.ready;
}

/** A throwaway in-memory database with migrations applied (tests). */
export async function createTestDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite();
  await client.waitReady;
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as Db;
}

export { schema };
