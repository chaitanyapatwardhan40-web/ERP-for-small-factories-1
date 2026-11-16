import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Classic rendering model: every ERP page reads the session cookie and the
  // database at request time, so nothing is prerendered. Cache Components can
  // be adopted later for the few public pages (portals) that benefit from it.
  cacheComponents: false,
  // PGlite ships a WASM binary and must not be bundled by Turbopack.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
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
