import { realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Snapshot, SnapshotDiff } from "@rae/schema";
import { diffSnapshots } from "./diff.ts";
import { changedFiles, commitInfo, exportCommit, fetchRequest, GitError, mergeBase, repoOf, resolveRef } from "./git.ts";
import { addTypes, scan, type ScanOptions, scanStructure } from "./scan.ts";

export interface DiffScanOptions extends ScanOptions {
  /** The base: a branch (`main`), tag or sha. Default: the repo's default branch. */
  base?: string;
  /** What's compared: a branch or sha. Default: `HEAD`. */
  head?: string;
  /** Or a pull / merge request's ref (`refs/pull/12/head`, `refs/merge-requests/3/head`): fetched from origin first. */
  request?: string;
  /** Compare against the merge-base of base and head (default, what a pull / merge request shows), or the base's tip. */
  against?: SnapshotDiff["against"];
  /** Where exported commits are kept (default: the OS temp folder). */
  treesDir?: string;
  /** Called with the diff snapshot before the head's type pass (UIs show it right away); the typed one is returned. */
  onStructure?: (snapshot: Snapshot) => void;
}

/**
 * Scans a folder at two commits and returns the head's snapshot with `diff`. Each commit is exported
 * to a folder of its own (`exportCommit`), so the checkout isn't touched. Both sides are compared
 * without types (types would differ only because one side has them); the head then gets its type
 * pass as asked, with the same diff. Paths are the project's (`rootDir` is the folder asked for);
 * when the head is the checked-out commit, files open from the checkout.
 */
export async function scanDiff(input: string, opts: DiffScanOptions = {}): Promise<Snapshot> {
  const dir = realpathSync(input);
  const repo = await repoOf(dir);
  if (!repo) throw new GitError(`Not in a git repository: ${dir}`);
  const baseRef = opts.base ?? repo.defaultBranch;
  if (!baseRef) throw new GitError("No base branch: pass one (no origin/HEAD, main or master)");
  // the checkout is named by its branch (when it's on one)
  const asked = opts.request ?? opts.head ?? "HEAD";
  const headRef = asked === "HEAD" && repo.branch ? repo.branch : asked;
  opts.onProgress?.(opts.request ? `fetching ${opts.request}` : `resolving ${headRef}`);
  const headSha = opts.request ? await fetchRequest(repo.root, { ref: opts.request }) : await resolveRef(repo.root, asked);
  const baseTip = await resolveRef(repo.root, baseRef);
  const against = opts.against ?? "merge-base";
  const compared = against === "merge-base" ? await mergeBase(repo.root, baseTip, headSha) : baseTip;
  opts.onProgress?.(`diff ${baseRef} (${compared.slice(0, 8)}) → ${headRef} (${headSha.slice(0, 8)})`);
  opts.signal?.throwIfAborted();

  // the scanned folder inside the repo ("" for the repo itself)
  const sub = relative(repo.root, dir).split(sep).join("/");
  const at = (tree: string) => (sub ? join(tree, sub) : tree);
  const [baseTree, headTree, changes, baseInfo, headInfo] = await Promise.all([
    exportCommit(repo.root, compared, opts.treesDir),
    exportCommit(repo.root, headSha, opts.treesDir),
    changedFiles(repo.root, compared, headSha),
    commitInfo(repo.root, baseTip),
    commitInfo(repo.root, headSha),
  ]);
  opts.signal?.throwIfAborted();

  const { base: _b, head: _h, request: _r, against: _a, treesDir: _t, onStructure, ...scanOpts } = opts;
  // progress counts follow the head's scan (the one the UI waits on)
  const baseSnap = await scan(at(baseTree), { ...scanOpts, types: false, onCount: undefined });
  const head = await scanStructure(at(headTree), { ...scanOpts, types: false });

  // changed files under the scanned folder, relative to it
  const prefix = sub ? `${sub}/` : "";
  const inside = (p: string) => !prefix || p.startsWith(prefix);
  const files = changes
    .filter((f) => inside(f.path) || (f.from && inside(f.from)))
    .map((f) => ({ ...f, path: f.path.slice(prefix.length), from: f.from?.slice(prefix.length) }));

  const diff = diffSnapshots(baseSnap, head.snapshot, files, {
    base: { ref: baseRef, sha: baseTip, subject: baseInfo.subject },
    head: { ref: headRef, sha: headSha, subject: headInfo.subject },
    against,
    compared,
  });

  // the project's paths: the checkout when it is the head, else the exported copy (what the head has)
  const headRoot = at(headTree);
  const finish = (s: Snapshot): Snapshot => {
    if (headSha === repo.head) for (const n of Object.values(s.nodes)) if (n.absPath?.startsWith(headRoot)) n.absPath = dir + n.absPath.slice(headRoot.length);
    return { ...s, rootDir: dir, diff };
  };
  const structure = finish(head.snapshot);
  onStructure?.(structure);
  if (opts.types === false) return structure;
  return finish(await addTypes(head, scanOpts));
}
