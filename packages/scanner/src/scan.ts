import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA_VERSION, type Snapshot, type SnapshotIndexEntry } from "@rae/schema";
import { loadCache, saveCache } from "./cache.ts";
import { collectFiles } from "./collect.ts";
import type { FileExtract } from "./extract/types.ts";
import { buildGraph } from "./graph.ts";
import { discoverProject } from "./project.ts";
import { applyTypes } from "./types/tsgo.ts";

export interface ScanOptions {
  tsconfig?: string;
  include?: string[];
  exclude?: string[];
  types?: boolean;
  cache?: boolean;
  maxWorkers?: number;
  onWarn?: (msg: string) => void;
}

export async function scan(input: string, opts: ScanOptions = {}): Promise<Snapshot> {
  const t0 = performance.now();
  const phases: Record<string, number> = {};
  let mark = t0;
  const phase = (name: string) => {
    const now = performance.now();
    phases[name] = Math.round((now - mark) * 10) / 10;
    mark = now;
  };

  const info = await discoverProject(input, opts);
  phase("discover");

  const cache = opts.cache === false ? undefined : loadCache(info.rootDir);
  phase("cacheLoad");

  const { files, cacheHits } = await collectFiles(info.initialFiles, {
    tsconfig: info.tsconfig,
    cache,
    maxWorkers: opts.maxWorkers,
    onWarn: opts.onWarn,
  });
  phase("parse");

  if (opts.types !== false) {
    // Types depend on the file itself and what it imports.
    const keyOf = (f: FileExtract) => {
      const deps = f.imports
        .map((i) => (i.resolved?.kind === "local" ? files.get(i.resolved.path)?.stamp : undefined))
        .filter(Boolean)
        .sort();
      return `${f.stamp}|${deps.join(",")}`;
    };
    try {
      await applyTypes([...files.values()], { rootDir: info.rootDir, tsconfig: info.tsconfig, keyOf, onWarn: opts.onWarn });
    } catch (e) {
      opts.onWarn?.(`type pass skipped: ${(e as Error).message}`);
    }
    phase("types");
  }

  if (opts.cache !== false) {
    saveCache(info.rootDir, files.values());
    phase("cacheSave");
  }

  const { nodes, edges } = buildGraph(files, info);
  phase("graph");

  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    rootDir: info.rootDir,
    entry: info.entry,
    framework: info.framework,
    stats: {
      files: files.size,
      durationMs: Math.round(performance.now() - t0),
      phases,
      cacheHits,
      types: opts.types !== false,
    },
    nodes,
    edges,
  };
}

/** Writes `<out>/<timestamp>.json` and updates `<out>/index.json`. Returns the snapshot path. */
export function writeSnapshot(snapshot: Snapshot, outDir: string): string {
  mkdirSync(outDir, { recursive: true });
  const file = `${snapshot.createdAt.replace(/[:.]/g, "-")}.json`;
  const path = join(outDir, file);
  writeFileSync(path, JSON.stringify(snapshot));
  const indexPath = join(outDir, "index.json");
  let index: SnapshotIndexEntry[] = [];
  if (existsSync(indexPath)) {
    try {
      index = JSON.parse(readFileSync(indexPath, "utf8"));
    } catch {
      index = [];
    }
  }
  index.unshift({
    file,
    createdAt: snapshot.createdAt,
    rootDir: snapshot.rootDir,
    framework: snapshot.framework,
    nodeCount: Object.keys(snapshot.nodes).length,
    edgeCount: snapshot.edges.length,
    durationMs: snapshot.stats.durationMs,
  });
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
  return path;
}
