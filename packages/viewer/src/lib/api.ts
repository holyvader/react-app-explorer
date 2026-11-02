import type { ScanEvent, Snapshot, SnapshotIndexEntry } from "@rae/schema";

export interface SnapshotList {
  dir: string;
  snapshots: (Pick<SnapshotIndexEntry, "file" | "createdAt"> & Partial<SnapshotIndexEntry>)[];
}

export async function fetchSnapshotList(): Promise<SnapshotList> {
  const res = await fetch("/api/snapshots/");
  if (!res.ok) throw new Error(`Failed to list snapshots (${res.status})`);
  return res.json();
}

/** Upgrades older snapshots in place: schema v1 named invokes edges `calls` / `callsAction`. */
export function normalizeSnapshot(s: Snapshot): Snapshot {
  if ((s.schemaVersion ?? 1) < 2) {
    for (const e of s.edges as { kind: string }[]) {
      if (e.kind === "calls") e.kind = "invokes";
      else if (e.kind === "callsAction") e.kind = "invokesAction";
    }
  }
  return s;
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
export async function runScan(path: string, types: boolean, onEvent: (e: ScanEvent) => void): Promise<void> {
  const res = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, types }),
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
