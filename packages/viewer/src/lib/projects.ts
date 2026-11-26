import type { Snapshot } from "@rae/schema";
import { deleteSnapshots, fetchSnapshotList, type ScanSettings, type SnapshotList } from "./api.ts";
import { readMergeSetting, SCAN_PATH_KEY, startScan } from "./scanJob.ts";
import { writeSetting } from "./settings.ts";
import { useExplorer } from "../store.ts";

/*
 * Projects, the way an IDE keeps them: opening one shows what was last read of it at once (its
 * cache: the newest snapshot of that view), then reads it again in the background and swaps the
 * fresh result in (the diagram stays: it's kept per project). Each view of a project — its working
 * tree, a branch's newest commit, a comparison — keeps one snapshot: once a newer one is written,
 * the older ones go. When something was read isn't shown anywhere; Manage projects removes them.
 */

type Entry = SnapshotList["snapshots"][number];

/** What of a project a snapshot shows. */
export type View = { kind: "worktree" } | { kind: "branch"; branch: string };

/** `origin/feat/x` and `feat/x` are one branch here (a branch's newest commit is fetched from origin). */
const branchName = (ref: string) => ref.replace(/^origin\//, "");

/**
 * One key per view: what replaces what. Comparisons by what they compare (refs, not commits), with
 * or without uncommitted changes, from the merge-base or the base's tip. An entry that doesn't say
 * which view it is (written before that was recorded, and unreadable) is a view of its own: never
 * shown as another's cache, never pruned with one.
 */
export function viewKey(e: Pick<Entry, "file" | "kind" | "diff" | "commit">): string {
  if (e.diff) return `diff:${e.diff.base.split(" ")[0]}..${e.diff.head.split(" ")[0]}${e.diff.worktree ? "+wt" : ""}${e.diff.against === "base" ? "@tip" : ""}`;
  if (e.commit) return `branch:${branchName(e.commit.ref)}`;
  return e.kind === "worktree" ? "worktree" : `unknown:${e.file}`;
}
const keyOfView = (v: View) => (v.kind === "worktree" ? "worktree" : `branch:${branchName(v.branch)}`);

/** What the app gives this module: the snapshot list, loading one, and listing again. */
export interface ProjectHost {
  list: () => SnapshotList | undefined;
  /** Loads a snapshot onto the screen (`quiet`: swapped in, no loading screen). */
  load: (file: string, quiet?: boolean) => Promise<void> | void;
  /** Lists the snapshots again (and loads `file`, when given). */
  relist: (file?: string, quiet?: boolean) => Promise<void> | void;
}
let host: ProjectHost | undefined;
/** The app registers how it lists and loads snapshots (App.tsx). */
export const registerProjectHost = (h: ProjectHost) => {
  host = h;
};

/** The newest snapshot of a project's view, if any. */
export function cachedEntry(list: SnapshotList | undefined, dir: string, view: View): Entry | undefined {
  const key = keyOfView(view);
  return (list?.snapshots ?? []).filter((s) => s.rootDir === dir && viewKey(s) === key).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/**
 * Opens a project's view: its cached snapshot at once and a quiet refresh behind it, or (nothing
 * cached) an open with progress. `refresh: false` only shows the cache when there is one.
 */
export async function openView(dir: string, view: View, opts: { refresh?: boolean } = {}): Promise<void> {
  if (!host) return;
  const cached = cachedEntry(host.list(), dir, view);
  if (cached) await host.load(cached.file);
  if (cached && opts.refresh === false) return;
  await read(dir, { latest: view.kind === "branch" ? view.branch : undefined }, !!cached);
}

/**
 * Reads a project (a view, or a comparison) and loads it; then, if it was read completely, the older
 * snapshots of that view go. A quiet refresh loads its result only while that project's same view
 * is still on screen (the user may have moved on).
 */
export async function read(dir: string, settings: Pick<ScanSettings, "latest" | "diff">, quiet = false): Promise<void> {
  if (!host) return;
  writeSetting(SCAN_PATH_KEY, dir);
  const outcome = await startScan(
    dir,
    { types: true, merge: readMergeSetting(), ...settings },
    (file) => {
      if (quiet && !stillShowing(dir, settings)) return void host?.relist();
      void host?.relist(file, quiet);
    },
    { quiet },
  );
  if (outcome.ok && outcome.file) await pruneOlder(outcome.file);
}

/** Whether the screen still shows this project's view (what a quiet refresh is refreshing). */
function stillShowing(dir: string, settings: Pick<ScanSettings, "latest" | "diff">): boolean {
  const s = useExplorer.getState().snapshot;
  if (!s || s.rootDir !== dir) return false;
  if (settings.diff) return !!s.diff && s.diff.base.ref === settings.diff.base;
  if (settings.latest) return !s.diff && !!s.commit && (settings.latest === true || branchName(s.commit.ref) === branchName(settings.latest));
  return !s.diff && !s.commit;
}

/** The request that reads a comparison again (Refresh while comparing). */
export function diffRequestOf(d: NonNullable<Snapshot["diff"]>): NonNullable<ScanSettings["diff"]> {
  const head = d.head;
  const which = head.request
    ? { request: head.ref, requestInfo: { title: head.request.title, author: head.request.author, url: head.request.url } }
    : head.worktree
      ? { worktree: true }
      : { head: head.ref };
  return { base: d.base.ref, against: d.against, ...which };
}

/** After `file` was written (and read completely): the other snapshots of its project's same view are removed. */
export async function pruneOlder(file: string): Promise<void> {
  try {
    const list = await fetchSnapshotList();
    const mine = list.snapshots.find((s) => s.file === file);
    if (!mine?.rootDir) return;
    const key = viewKey(mine);
    const older = list.snapshots.filter((s) => s.file !== file && s.rootDir === mine.rootDir && viewKey(s) === key).map((s) => s.file);
    if (!older.length) return;
    await deleteSnapshots(older);
    await host?.relist();
  } catch {
    /* the cache keeps an extra copy: harmless */
  }
}

/** Every cached snapshot of these projects removed (Manage projects): the files that went. */
export async function removeProjects(dirs: string[]): Promise<string[]> {
  const list = await fetchSnapshotList();
  const files = list.snapshots.filter((s) => s.rootDir && dirs.includes(s.rootDir)).map((s) => s.file);
  return files.length ? deleteSnapshots(files) : [];
}
