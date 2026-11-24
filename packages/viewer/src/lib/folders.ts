import type { Framework } from "@rae/schema";
import type { SnapshotList } from "./api.ts";

/** A scanned folder: its newest snapshot (opened when it's picked) and how many there are. */
export interface ScannedFolder {
  dir: string;
  latest: SnapshotList["snapshots"][number];
  count: number;
  framework?: Framework;
}

/** The snapshot list grouped by scanned folder, most recently scanned first. */
export function scannedFolders(list: SnapshotList | undefined): ScannedFolder[] {
  const byDir = new Map<string, ScannedFolder>();
  for (const s of list?.snapshots ?? []) {
    if (!s.rootDir) continue;
    const f = byDir.get(s.rootDir);
    if (!f) byDir.set(s.rootDir, { dir: s.rootDir, latest: s, count: 1, framework: s.framework });
    else {
      f.count++;
      if (s.createdAt > f.latest.createdAt) f.latest = s;
    }
  }
  return [...byDir.values()].sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));
}

/** Looks like a path someone pasted (absolute, ~, or a Windows drive), rather than a filter. */
export const looksLikePath = (q: string) => /^(\/|~(\/|$)|[A-Za-z]:[\\/])/.test(q.trim());

/** `~/x` → `/Users/me/x`, with the home folder taken from the folders already scanned (the server wants absolute paths). */
export function expandHome(path: string, known: string[]): string {
  const p = path.trim();
  if (!p.startsWith("~")) return p;
  const home = known.map((d) => d.match(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/)?.[1]).find(Boolean);
  return home ? home + p.slice(1) : p;
}
