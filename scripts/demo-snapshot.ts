/**
 * Builds data/demo.tar.gz: an image of the sample company that demo mode
 * loads into memory at startup, so the app can run with no database.
 *
 *   npm run demo:snapshot            rebuild unconditionally
 *   npm run demo:snapshot -- --fresh rebuild only if missing or older than MAX_AGE_DAYS
 */
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "data", "demo.tar.gz");
const MAX_AGE_DAYS = 3;

async function main() {
  const freshOnly = process.argv.includes("--fresh");
  if (freshOnly && fs.existsSync(OUT)) {
    const ageDays = (Date.now() - fs.statSync(OUT).mtimeMs) / 86_400_000;
    if (ageDays < MAX_AGE_DAYS) {
      console.log(`demo snapshot is ${ageDays.toFixed(1)} days old; keeping it`);
      return;
    }
  }
  process.env.PGLITE_DATA_DIR = "memory://";
  process.env.KITWISE_DEMO = "0";
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.POSTGRES_PRISMA_URL;
  delete process.env.KITWISE_SEED;

  const { getDb, getEmbeddedClient } = await import("../src/lib/db");
  const { seedDemo } = await import("../src/lib/db/seed");
  await getDb();
  await seedDemo();
  const client = getEmbeddedClient();
  if (!client) throw new Error("expected the embedded database");
  // Checkpoint so the image is consistent, then pack the data directory.
  await client.exec("checkpoint");
  const image = await client.dumpDataDir("gzip");
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(await image.arrayBuffer()));
  await client.close();
  console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    if (process.argv.includes("--fresh") && fs.existsSync(OUT)) {
      console.warn("demo snapshot rebuild failed; keeping the existing one:", e);
      process.exit(0);
    }
    console.error(e);
    process.exit(1);
  });
