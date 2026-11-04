import { basename } from "node:path";
import type { ScanEvent, Snapshot } from "@rae/schema";
import { scanDiff } from "./diffScan.ts";
import { addTypes, type ScanOptions, scanStructure, writeSnapshot } from "./scan.ts";

export type { ScanEvent };

/**
 * A scan as a stream of events, for UIs: the structure snapshot is written (and announced) first,
 * so the diagram can show right away; the type pass then runs and overwrites the same file.
 *
 * The packaged app's server runs this in-process; `rae-scan --events` prints it as NDJSON for the
 * Vite dev plugin. Both send the events (`ScanEvent`, in @rae/schema) to the viewer as NDJSON.
 */
export interface ScanJobOptions extends Omit<ScanOptions, "onCount"> {
  outDir: string;
  /** Cancels the job: it emits `cancelled` and resolves. */
  signal?: AbortSignal;
  /** Diff mode: scan the folder at two commits and compare them (see scanDiff). */
  diff?: ScanDiffRequest;
}

/** What a UI asks to compare: a base ref, and a head ref or a pull / merge request's ref. */
export interface ScanDiffRequest {
  base?: string;
  head?: string;
  request?: string;
  against?: "merge-base" | "base";
}

export function summary(snapshot: Snapshot): string {
  const nodes = Object.values(snapshot.nodes);
  const count = (k: string) => nodes.filter((n) => n.kind === k).length;
  return `✔ ${snapshot.stats.files} files → ${nodes.length} nodes (${count("component")} components, ${count("hook")} hooks, ${count("serverAction")} actions, ${count("external")} external), ${snapshot.edges.length} edges in ${snapshot.stats.durationMs}ms`;
}

/** Runs a scan, emitting events; resolves after `done` (or `error`). Never throws. */
export async function runScanJob(input: string, opts: ScanJobOptions, emit: (e: ScanEvent) => void): Promise<void> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  let warnings: string[] = [];
  // progress events at most every ~50ms per stage (plus the last one), not one per file
  const last = new Map<string, number>();
  const onCount = (stage: "parse" | "types", done: number, total: number, loading?: boolean) => {
    const now = performance.now();
    // always send the first, the last and loading changes; in between, at most every ~50ms
    if (loading === undefined && done > 0 && done < total && now - (last.get(stage) ?? 0) < 50) return;
    last.set(stage, now);
    emit({ type: "progress", stage, done, total, ...(loading !== undefined ? { loading } : {}) });
  };
  const scanOpts: ScanOptions = {
    ...opts,
    onCount,
    onWarn: (m) => {
      warnings.push(m);
      opts.onWarn?.(m);
    },
  };
  try {
    emit({ type: "progress", stage: "discover" });
    if (opts.diff) {
      // the diff snapshot without types first, then the typed one replacing the same file
      let file = "";
      const typesPending = opts.types !== false;
      const typed = await scanDiff(input, {
        ...scanOpts,
        ...opts.diff,
        onStructure: (snap) => {
          emit({ type: "progress", stage: "graph" });
          file = basename(writeSnapshot(snap, opts.outDir));
          emit({ type: "result", file, stdout: summary(snap), ms: ms(), warnings, typesPending });
          warnings = [];
        },
      });
      if (typesPending) {
        writeSnapshot(typed, opts.outDir);
        emit({ type: "types", file, ms: ms(), typed: typed.stats.types, warnings });
      }
      emit({ type: "done" });
      return;
    }
    const structure = await scanStructure(input, scanOpts);
    emit({ type: "progress", stage: "graph" });
    const file = basename(writeSnapshot(structure.snapshot, opts.outDir));
    const typesPending = opts.types !== false;
    emit({ type: "result", file, stdout: summary(structure.snapshot), ms: ms(), warnings, typesPending });
    if (typesPending) {
      warnings = [];
      const typed = await addTypes(structure, scanOpts);
      writeSnapshot(typed, opts.outDir);
      emit({ type: "types", file, ms: ms(), typed: typed.stats.types, warnings });
    }
    emit({ type: "done" });
  } catch (e) {
    if (opts.signal?.aborted) emit({ type: "cancelled" });
    else emit({ type: "error", message: (e as Error).message ?? String(e) });
  }
}
