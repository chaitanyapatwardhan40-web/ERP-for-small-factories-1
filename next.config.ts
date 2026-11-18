import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Classic rendering model: every business page reads the session cookie and
  // the database at request time, so nothing is prerendered.
  cacheComponents: false,
  // PGlite ships a WASM binary and must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  // Files the server needs at runtime that static analysis cannot see:
  // SQL migrations, the demo database image and the embedded Postgres runtime.
  outputFileTracingIncludes: {
    "/*": ["./drizzle/**/*", "./data/demo.tar.gz", "./node_modules/@electric-sql/pglite/dist/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
