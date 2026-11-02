import { readFileSync, statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { extractFile } from "./extract/index.ts";
import type { FileExtract } from "./extract/types.ts";
import { createResolver } from "./resolve.ts";
import type { WorkerRequest, WorkerResponse } from "./workers/extract.worker.ts";

export interface CollectOptions {
  tsconfig?: string;
  cache?: Map<string, FileExtract>;
  maxWorkers?: number;
  onWarn?: (msg: string) => void;
  /** Files parsed so far, out of those found so far (the total grows as imports are followed). */
  onCount?: (done: number, total: number) => void;
  /** Stops parsing: workers are terminated and collectFiles rejects with an AbortError. */
  signal?: AbortSignal;
}

export interface CollectResult {
  files: Map<string, FileExtract>;
  cacheHits: number;
  workers: number;
}

const INLINE_THRESHOLD = 48;
const CHUNK = 32;

function stampOf(path: string): string | undefined {
  try {
    const s = statSync(path);
    return `${s.mtimeMs}-${s.size}`;
  } catch {
    return undefined;
  }
}

/**
 * Parses + extracts all reachable files. Starts from `initial`, follows local imports transitively.
 * Work is spread across a lazily grown pool of Bun workers; small batches run inline.
 */
export async function collectFiles(initial: string[], opts: CollectOptions = {}): Promise<CollectResult> {
  const maxWorkers = opts.maxWorkers ?? Math.max(1, availableParallelism() - 1);
  const files = new Map<string, FileExtract>();
  const seen = new Set<string>(initial);
  const queue: { path: string; stamp: string }[] = [];
  let cacheHits = 0;
  let inlineResolver: ReturnType<typeof createResolver> | undefined;

  const accept = (x: FileExtract) => {
    files.set(x.absPath, x);
    for (const imp of x.imports) {
      if (imp.resolved?.kind === "local" && !seen.has(imp.resolved.path)) {
        seen.add(imp.resolved.path);
        enqueue(imp.resolved.path);
      }
    }
    opts.onCount?.(files.size, seen.size);
  };

  const enqueue = (path: string) => {
    const stamp = stampOf(path);
    if (!stamp) return;
    const cached = opts.cache?.get(path);
    if (cached && cached.stamp === stamp) {
      cacheHits++;
      accept(cached);
      return;
    }
    queue.push({ path, stamp });
  };

  for (const p of initial) enqueue(p);

  const workers: Worker[] = [];
  const idle: Worker[] = [];
  const pending = new Map<number, (r: WorkerResponse) => void>();
  let nextId = 0;
  let inflight = 0;
  let wake: (() => void) | undefined;

  // A worker that fails (couldn't load, crashed) must fail the scan — not leave it waiting forever.
  let failure: Error | undefined;
  const spawn = () => {
    // Compiled executables (the desktop app's server) pack the worker elsewhere: the build passes its path.
    const w = new Worker(process.env.RAE_EXTRACT_WORKER || new URL("./workers/extract.worker.ts", import.meta.url).href);
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      pending.get(ev.data.id)?.(ev.data);
      pending.delete(ev.data.id);
    };
    w.onerror = (ev: ErrorEvent) => {
      ev.preventDefault?.();
      failure ??= new Error(`A parser worker failed: ${ev.message || "it couldn't start"}`);
      wake?.();
    };
    workers.push(w);
    idle.push(w);
  };

  const dispatch = (w: Worker, batch: { path: string; stamp: string }[]) => {
    const id = nextId++;
    inflight++;
    pending.set(id, (res) => {
      inflight--;
      idle.push(w);
      for (const f of res.failed) opts.onWarn?.(`failed to parse ${f.path}: ${f.error}`);
      for (const x of res.results) accept(x);
      wake?.();
    });
    w.postMessage({ id, files: batch, tsconfig: opts.tsconfig } satisfies WorkerRequest);
  };

  const onAbort = () => wake?.();
  opts.signal?.addEventListener("abort", onAbort);
  const stop = () => {
    for (const w of workers) w.terminate();
    opts.signal?.removeEventListener("abort", onAbort);
  };

  while (queue.length || inflight) {
    if (opts.signal?.aborted) {
      stop();
      opts.signal.throwIfAborted();
    }
    if (failure) {
      stop();
      throw failure;
    }
    // Small amount of work and nothing running: do it inline, avoids worker startup cost.
    if (!inflight && workers.length === 0 && queue.length <= INLINE_THRESHOLD) {
      inlineResolver ??= createResolver(opts.tsconfig);
      const batch = queue.splice(0, queue.length);
      for (const f of batch) {
        if (opts.signal?.aborted) break;
        try {
          accept(extractFile(f.path, readFileSync(f.path, "utf8"), f.stamp, inlineResolver));
        } catch (e) {
          opts.onWarn?.(`failed to parse ${f.path}: ${(e as Error).message}`);
        }
      }
      continue;
    }
    while (queue.length && workers.length < maxWorkers && queue.length > CHUNK * workers.length) spawn();
    while (queue.length && idle.length) {
      const share = Math.ceil(queue.length / Math.max(1, workers.length));
      dispatch(idle.pop()!, queue.splice(0, Math.min(CHUNK * 4, Math.max(CHUNK, share))));
    }
    if (inflight) await new Promise<void>((r) => (wake = r));
  }

  stop();
  opts.signal?.throwIfAborted();
  return { files, cacheHits, workers: workers.length };
}
