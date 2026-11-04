import type { GitOverview, GitRequest, ScanEvent, Snapshot, SnapshotIndexEntry } from "@rae/schema";
import { applyDiff } from "./diff.ts";

export interface SnapshotList {
  dir: string;
  /** The desktop app's server log (where scan failures are detailed); absent in dev. */
  logFile?: string;
  /** Set by the desktop app's server. */
  desktop?: boolean;
  snapshots: (Pick<SnapshotIndexEntry, "file" | "createdAt"> & Partial<SnapshotIndexEntry>)[];
}

/** The server's log file, once known (the desktop app reports it with the snapshot list). */
export let serverLogFile: string | undefined;
/** Whether the viewer runs in the desktop app (its server says so with the snapshot list). */
export let serverIsDesktop = false;

export async function fetchSnapshotList(): Promise<SnapshotList> {
  const res = await fetch("/api/snapshots/");
  if (!res.ok) throw new Error(`Failed to list snapshots (${res.status})`);
  const list = (await res.json()) as SnapshotList;
  serverLogFile = list.logFile;
  serverIsDesktop = list.desktop === true;
  return list;
}

/** Upgrades older snapshots in place (schema v1 named invokes edges `calls` / `callsAction`); a diff's removed nodes become ghosts. */
export function normalizeSnapshot(s: Snapshot): Snapshot {
  if ((s.schemaVersion ?? 1) < 2) {
    for (const e of s.edges as { kind: string }[]) {
      if (e.kind === "calls") e.kind = "invokes";
      else if (e.kind === "callsAction") e.kind = "invokesAction";
    }
  }
  return applyDiff(s);
}

export async function fetchSnapshot(file: string): Promise<Snapshot> {
  const res = await fetch(`/api/snapshots/${encodeURIComponent(file)}`);
  if (!res.ok) throw new Error(`Failed to load ${file} (${res.status})`);
  return normalizeSnapshot(await res.json());
}

export async function readSnapshotFile(file: File): Promise<Snapshot> {
  const data = JSON.parse(await file.text());
  if (!data || typeof data !== "object" || !data.nodes || !Array.isArray(data.edges)) {
    throw new Error("Not a scanner snapshot (missing nodes/edges)");
  }
  return normalizeSnapshot(data as Snapshot);
}

export interface FsListing {
  path: string;
  parent: string | null;
  entries: { name: string; path: string; kind: "dir" | "file" }[];
  /** Project markers found in this dir (package.json, tsconfig.json, next.config.*). */
  markers: string[];
}

export async function listDir(path?: string): Promise<FsListing> {
  const res = await fetch(`/api/fs${path ? `?path=${encodeURIComponent(path)}` : ""}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Failed to list ${path}`);
  return data;
}

/**
 * Starts a scan and reports its events as they stream in (NDJSON): progress, the structure snapshot,
 * then the typed snapshot. Resolves when the stream ends; rejects if the scan can't start.
 */
/** How to scan: TypeScript type info, and merging files that declare one exported thing into it. */
export interface ScanSettings {
  types: boolean;
  merge: boolean;
  /** Diff mode: compare `head` (a branch / sha) or `request` (a PR / MR ref) with `base`. */
  diff?: { base?: string; head?: string; request?: string; against?: "merge-base" | "base" };
}

/** The git repo a folder is in, with its branches. */
export async function fetchGit(path: string): Promise<GitOverview> {
  const res = await fetch(`/api/git?path=${encodeURIComponent(path)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "git info failed");
  return data;
}

/** Open pull / merge requests on origin (from the refs GitHub / GitLab publish; a network call). */
export async function fetchGitRequests(path: string): Promise<{ requests: GitRequest[]; error?: string }> {
  const res = await fetch(`/api/git/requests?path=${encodeURIComponent(path)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "listing requests failed");
  return data;
}

export async function runScan(path: string, { types, merge, diff }: ScanSettings, onEvent: (e: ScanEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch("/api/scan", {
    signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, types, merge, diff }),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Scan failed (${res.status})`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as ScanEvent);
    }
    if (done) break;
  }
}

/** Deletes snapshot files (and their index entries). Returns the files removed. */
export async function deleteSnapshots(files: string[]): Promise<string[]> {
  const res = await fetch("/api/snapshots/", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Delete failed (${res.status})`);
  return data.removed ?? [];
}
