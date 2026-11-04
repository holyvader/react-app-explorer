import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA_VERSION, type Snapshot, type SnapshotIndexEntry } from "@rae/schema";
import { loadCache, saveCache } from "./cache.ts";
import { collectFiles } from "./collect.ts";
import type { FileExtract } from "./extract/types.ts";
import { buildGraph } from "./graph.ts";
import { mergeSingleExportModules } from "./merge.ts";
import { discoverProject } from "./project.ts";
import { applyTypes } from "./types/tsgo.ts";

export interface ScanOptions {
  tsconfig?: string;
  include?: string[];
  exclude?: string[];
  types?: boolean;
  cache?: boolean;
  maxWorkers?: number;
  /** Files that declare one exported thing become that declaration (default on). */
  mergeSingleExport?: boolean;
  onWarn?: (msg: string) => void;
  /** Step-by-step progress (for logs): each phase as it starts and ends. */
  onProgress?: (msg: string) => void;
  /** Counts for a progress bar: files parsed out of those found so far, then files typed out of the
   *  total (`loading` while TypeScript loads the project, before any file is typed). */
  onCount?: (stage: "parse" | "types", done: number, total: number, loading?: boolean) => void;
  /** Cancels the scan: parsing stops, the type checker is killed, the promise rejects (AbortError). */
  signal?: AbortSignal;
}

/** A scanned project before (or after) the type pass: what `addTypes` needs to continue. */
export interface StructureScan {
  snapshot: Snapshot;
  files: Map<string, FileExtract>;
  info: Awaited<ReturnType<typeof discoverProject>>;
  phases: Record<string, number>;
  cacheHits: number;
  t0: number;
}

function phaseTimer(phases: Record<string, number>, onProgress?: (m: string) => void) {
  let mark = performance.now();
  return (name: string) => {
    const now = performance.now();
    phases[name] = Math.round((now - mark) * 10) / 10;
    mark = now;
    onProgress?.(`${name} done in ${phases[name]}ms`);
  };
}

function toSnapshot(scan: Omit<StructureScan, "snapshot">, createdAt: string, types: boolean, merge: boolean): Snapshot {
  const graph = buildGraph(scan.files, scan.info);
  const { nodes, edges } = merge ? mergeSingleExportModules(graph.nodes, graph.edges) : graph;
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt,
    rootDir: scan.info.rootDir,
    entry: scan.info.entry,
    framework: scan.info.framework,
    next: scan.info.framework === "next-app" ? { cacheComponents: !!scan.info.cacheComponents } : undefined,
    stats: {
      files: scan.files.size,
      durationMs: Math.round(performance.now() - scan.t0),
      phases: { ...scan.phases },
      cacheHits: scan.cacheHits,
      types,
    },
    options: { mergeSingleExport: merge },
    nodes,
    edges,
  };
}

/**
 * Everything but the TypeScript type pass: discovery, parsing, the graph. Fast — the diagram can be
 * shown from it while `addTypes` runs. Files unchanged since a typed scan keep their cached types.
 */
export async function scanStructure(input: string, opts: ScanOptions = {}): Promise<StructureScan> {
  const t0 = performance.now();
  const phases: Record<string, number> = {};
  const phase = phaseTimer(phases, opts.onProgress);
  opts.onProgress?.(`scan ${input} (types ${opts.types !== false ? "on" : "off"})`);

  const info = await discoverProject(input, opts);
  phase("discover");
  opts.signal?.throwIfAborted();

  const cache = opts.cache === false ? undefined : loadCache(info.rootDir);
  phase("cacheLoad");

  const { files, cacheHits } = await collectFiles(info.initialFiles, {
    // only an explicit --tsconfig applies to every file; otherwise each file resolves with its
    // nearest tsconfig (monorepo packages and Vite-style references keep their own aliases)
    tsconfig: opts.tsconfig,
    cache,
    maxWorkers: opts.maxWorkers,
    onWarn: opts.onWarn,
    onCount: opts.onCount && ((done, total) => opts.onCount!("parse", done, total)),
    signal: opts.signal,
  });
  phase("parse");

  if (opts.cache !== false) {
    saveCache(info.rootDir, files.values());
    phase("cacheSave");
  }

  const partial = { files, info, phases, cacheHits, t0 };
  const snapshot = toSnapshot(partial, new Date().toISOString(), false, opts.mergeSingleExport !== false);
  phase("graph");
  return { ...partial, snapshot };
}

/**
 * The TypeScript type pass on a structure scan. Returns the typed snapshot — same `createdAt`, so it
 * replaces the structure snapshot's file. Never throws: if types fail, the scan stays untyped (warned).
 */
export async function addTypes(scan: StructureScan, opts: ScanOptions = {}): Promise<Snapshot> {
  const phase = phaseTimer(scan.phases, opts.onProgress);
  const { files, info } = scan;
  // Types depend on the file itself and what it imports.
  const keyOf = (f: FileExtract) => {
    const deps = f.imports
      .map((i) => (i.resolved?.kind === "local" ? files.get(i.resolved.path)?.stamp : undefined))
      .filter(Boolean)
      .sort();
    return `${f.stamp}|${deps.join(",")}`;
  };
  let typed = true;
  try {
    opts.onProgress?.(`types: ${files.size} files, tsconfig ${info.tsconfig ?? "(none)"}`);
    await applyTypes([...files.values()], {
      rootDir: info.rootDir,
      tsconfig: info.tsconfig,
      keyOf,
      onWarn: opts.onWarn,
      onProgress: opts.onProgress,
      onCount: opts.onCount && ((done, total, loading) => opts.onCount!("types", done, total, loading)),
      signal: opts.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e; // cancelled, not failed
    typed = false;
    opts.onWarn?.(`type pass skipped: ${(e as Error).message}`);
  }
  phase("types");

  if (opts.cache !== false) {
    saveCache(info.rootDir, files.values());
    phase("cacheSave");
  }
  const snapshot = toSnapshot(scan, scan.snapshot.createdAt, typed, opts.mergeSingleExport !== false);
  phase("graph");
  return snapshot;
}

/** Structure + types in one go (the CLI, tests). */
export async function scan(input: string, opts: ScanOptions = {}): Promise<Snapshot> {
  const structure = await scanStructure(input, opts);
  return opts.types === false ? structure.snapshot : addTypes(structure, opts);
}

/** Writes `<out>/<timestamp>.json` and updates `<out>/index.json` (same file → replaced). Returns the snapshot path. */
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
  index = index.filter((e) => e.file !== file); // a typed snapshot replaces its structure-only version
  index.unshift({
    file,
    createdAt: snapshot.createdAt,
    rootDir: snapshot.rootDir,
    framework: snapshot.framework,
    nodeCount: Object.keys(snapshot.nodes).length,
    edgeCount: snapshot.edges.length,
    durationMs: snapshot.stats.durationMs,
    ...(snapshot.diff
      ? { diff: { base: `${snapshot.diff.base.ref} ${snapshot.diff.compared.slice(0, 7)}`, head: `${snapshot.diff.head.ref} ${snapshot.diff.head.sha.slice(0, 7)}`, changes: Object.keys(snapshot.diff.nodes).length } }
      : {}),
  });
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
  return path;
}
