/**
 * File-based cache for X research results.
 * 15-minute TTL. Avoids redundant API calls.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

const CACHE_DIR = join(import.meta.dir, "..", "data", "cache");
const TTL_MS = 15 * 60 * 1000; // 15 minutes

function ensureDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cacheKey(query: string, params: string): string {
  const hash = createHash("md5").update(`${query}|${params}`).digest("hex").slice(0, 12);
  return hash;
}

export function get(query: string, params: string): any[] | null {
  ensureDir();
  const key = cacheKey(query, params);
  const path = join(CACHE_DIR, `${key}.json`);

  if (!existsSync(path)) return null;

  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (Date.now() - raw.timestamp > TTL_MS) {
      unlinkSync(path);
      return null;
    }
    return raw.data;
  } catch {
    return null;
  }
}

export function set(query: string, params: string, data: any[]): void {
  ensureDir();
  const key = cacheKey(query, params);
  const path = join(CACHE_DIR, `${key}.json`);

  writeFileSync(
    path,
    JSON.stringify({ query, params, timestamp: Date.now(), data }, null, 2)
  );
}

export function clear(): number {
  ensureDir();
  const files = readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    unlinkSync(join(CACHE_DIR, f));
  }
  return files.length;
}

export function prune(): number {
  ensureDir();
  const files = readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));
  let removed = 0;

  for (const f of files) {
    const path = join(CACHE_DIR, f);
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      if (Date.now() - raw.timestamp > TTL_MS) {
        unlinkSync(path);
        removed++;
      }
    } catch {
      unlinkSync(path);
      removed++;
    }
  }

  return removed;
}
