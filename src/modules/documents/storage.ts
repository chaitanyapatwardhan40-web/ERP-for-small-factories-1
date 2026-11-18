import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isDemo } from "@/lib/env";

/**
 * File storage with two backends: Vercel Blob when BLOB_READ_WRITE_TOKEN is
 * set (production), a local folder otherwise: ./.data/uploads in development,
 * the system temp folder in demo mode (read-only app directory on serverless).
 * The attachment row stores only a storage key; the API route resolves it.
 */
export type Stored = { key: string; size: number };

const LOCAL_ROOT = process.env.KITWISE_UPLOAD_DIR ?? (isDemo() ? path.join(os.tmpdir(), "kitwise-uploads") : path.join(process.cwd(), ".data", "uploads"));

export async function storeFile(orgId: string, filename: string, data: Buffer, mime: string): Promise<Stored> {
  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(0, 120);
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const blob = await put(`${orgId}/${randomUUID()}-${safe}`, data, { access: "public", contentType: mime, addRandomSuffix: false });
    return { key: `blob:${blob.url}`, size: data.length };
  }
  const dir = path.join(LOCAL_ROOT, orgId);
  await fs.mkdir(dir, { recursive: true });
  const name = `${randomUUID()}-${safe}`;
  await fs.writeFile(path.join(dir, name), data);
  return { key: `local:${orgId}/${name}`, size: data.length };
}

export async function readFile(key: string): Promise<{ redirect?: string; data?: Buffer }> {
  if (key.startsWith("blob:")) return { redirect: key.slice(5) };
  if (key.startsWith("local:")) {
    const rel = key.slice(6);
    if (rel.includes("..")) throw new Error("Bad key");
    return { data: await fs.readFile(path.join(LOCAL_ROOT, rel)) };
  }
  throw new Error("Unknown storage key");
}
