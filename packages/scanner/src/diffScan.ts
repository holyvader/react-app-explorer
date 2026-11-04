import { realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Snapshot, SnapshotDiff } from "@rae/schema";
import { diffSnapshots } from "./diff.ts";
import { changedFiles, commitInfo, exportCommit, GitError, mergeBase, repoOf, resolveRef } from "./git.ts";
import { scan, type ScanOptions } from "./scan.ts";

export interface DiffScanOptions extends ScanOptions {
  /** The base: a branch (`main`), tag or sha. Default: the repo's default branch. */
  base?: string;
  /** What's compared: a branch, sha or fetched request (`FETCH_HEAD`). Default: `HEAD`. */
  head?: string;
  /** Compare against the merge-base of base and head (default, what a pull / merge request shows), or the base's tip. */
  against?: SnapshotDiff["against"];
  /** Where exported commits are kept (default: the OS temp folder). */
  treesDir?: string;
}

/**
 * Scans a folder at two commits and returns the head's snapshot with `diff`. Each commit is exported
 * to a folder of its own (`exportCommit`), so the checkout isn't touched. The base is scanned without
 * types (only structure is compared); the head as asked. Paths are the project's (`rootDir` is the
 * folder asked for); when the head is the checked-out commit, files open from the checkout.
 */
export async function scanDiff(input: string, opts: DiffScanOptions = {}): Promise<Snapshot> {
  const dir = realpathSync(input);
  const repo = await repoOf(dir);
  if (!repo) throw new GitError(`Not in a git repository: ${dir}`);
  const baseRef = opts.base ?? repo.defaultBranch;
  if (!baseRef) throw new GitError("No base branch: pass one (no origin/HEAD, main or master)");
  const headRef = opts.head ?? "HEAD";
  const [baseTip, headSha] = await Promise.all([resolveRef(repo.root, baseRef), resolveRef(repo.root, headRef)]);
  const against = opts.against ?? "merge-base";
  const compared = against === "merge-base" ? await mergeBase(repo.root, baseTip, headSha) : baseTip;
  opts.onProgress?.(`diff ${baseRef} (${compared.slice(0, 8)}) → ${headRef} (${headSha.slice(0, 8)})`);

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

  const { base: _b, head: _h, against: _a, treesDir: _t, ...scanOpts } = opts;
  const baseSnap = await scan(at(baseTree), { ...scanOpts, types: false });
  const headSnap = await scan(at(headTree), scanOpts);

  // changed files under the scanned folder, relative to it
  const prefix = sub ? `${sub}/` : "";
  const inside = (p: string) => !prefix || p.startsWith(prefix);
  const files = changes
    .filter((f) => inside(f.path) || (f.from && inside(f.from)))
    .map((f) => ({ ...f, path: f.path.slice(prefix.length), from: f.from?.slice(prefix.length) }));

  const diff = diffSnapshots(baseSnap, headSnap, files, {
    base: { ref: baseRef, sha: baseTip, subject: baseInfo.subject },
    head: { ref: headRef, sha: headSha, subject: headInfo.subject },
    against,
    compared,
  });

  // the project's paths: the checkout when it is the head, else the exported copy (what the head has)
  const fromCheckout = headSha === repo.head;
  const headRoot = at(headTree);
  if (fromCheckout) {
    for (const n of Object.values(headSnap.nodes)) if (n.absPath?.startsWith(headRoot)) n.absPath = dir + n.absPath.slice(headRoot.length);
  }
  return { ...headSnap, rootDir: dir, diff };
}
