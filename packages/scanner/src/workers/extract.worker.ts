/// <reference lib="webworker" />
import { readFileSync } from "node:fs";
import { extractFile } from "../extract/index.ts";
import type { FileExtract } from "../extract/types.ts";
import { createResolver } from "../resolve.ts";

export interface WorkerRequest {
  id: number;
  tsconfig?: string;
  files: { path: string; stamp: string }[];
}
export interface WorkerResponse {
  id: number;
  results: FileExtract[];
  failed: { path: string; error: string }[];
}

let resolver: ReturnType<typeof createResolver> | undefined;

declare const self: Worker;
self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const { id, files, tsconfig } = ev.data;
  resolver ??= createResolver(tsconfig);
  const results: FileExtract[] = [];
  const failed: WorkerResponse["failed"] = [];
  for (const f of files) {
    try {
      results.push(extractFile(f.path, readFileSync(f.path, "utf8"), f.stamp, resolver));
    } catch (e) {
      failed.push({ path: f.path, error: String((e as Error)?.message ?? e) });
    }
  }
  self.postMessage({ id, results, failed } satisfies WorkerResponse);
};
