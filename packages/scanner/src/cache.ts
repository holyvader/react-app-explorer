import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FileExtract } from "./extract/types.ts";

/** Bump when extract output changes shape/semantics to invalidate caches. */
export const EXTRACT_VERSION = 17; // 17: return statements' hash. 16: 16: annotations as written (props / params / return). 15: 15: types printed without truncation. 14: 14: declarations' endLine + source hash (diffs). 13: 13: "use cache", cacheLife / cacheTag, revalidateTag / updateTag, plain fetch()

export function cachePath(rootDir: string) {
  return join(rootDir, ".explorer", "cache", `extract-v${EXTRACT_VERSION}.json`);
}

export function loadCache(rootDir: string): Map<string, FileExtract> {
  const p = cachePath(rootDir);
  if (!existsSync(p)) return new Map();
  try {
    const data = JSON.parse(readFileSync(p, "utf8")) as FileExtract[];
    return new Map(data.map((f) => [f.absPath, f]));
  } catch {
    return new Map();
  }
}

export function saveCache(rootDir: string, files: Iterable<FileExtract>) {
  const p = cachePath(rootDir);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify([...files]));
}
