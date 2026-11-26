import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Snapshot, SnapshotIndexEntry } from "@rae/schema";
import { indexViewOf } from "./scan.ts";

/**
 * The snapshot index with every entry saying which view of its project it is (`kind`, a branch's
 * `commit`, a comparison's `worktree` / `against`). Entries written before those were recorded are
 * read from their snapshot once and the index saved: a viewer keeps one snapshot per view, and an
 * entry it can't place would be taken for the working tree (and pruned as one).
 */
export function upgradeIndex(dir: string, entries: SnapshotIndexEntry[]): SnapshotIndexEntry[] {
  let changed = false;
  const out = entries.map((e) => {
    if (e.kind || !e.file) return e;
    try {
      const s = JSON.parse(readFileSync(join(dir, basename(e.file)), "utf8")) as Pick<Snapshot, "diff" | "commit">;
      changed = true;
      return { ...e, ...indexViewOf(s) };
    } catch {
      return e; // unreadable: left as it is (viewers treat an entry without `kind` as its own view)
    }
  });
  if (changed) {
    try {
      writeFileSync(join(dir, "index.json"), JSON.stringify(out, null, 2));
    } catch {
      /* read-only: upgraded again next time */
    }
  }
  return out;
}
