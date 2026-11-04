import { realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Snapshot, SnapshotDiff } from "@rae/schema";
import { diffSnapshots } from "./diff.ts";
import { changedFiles, commitInfo, exportCommit, fetchRequest, GitError, mergeBase, repoOf, resolveRef } from "./git.ts";
import { addTypes, type ScanOptions, scanStructure } from "./scan.ts";

export interface DiffScanOptions extends ScanOptions {
  /** The base: a branch (`main`), tag or sha. Default: the repo's default branch. */
  base?: string;
  /** What's compared: a branch or sha. Default: `HEAD`. */
  head?: string;
  /** What the host CLI said about `request`: kept on the diff's head side. */
  requestInfo?: { title?: string; author?: string; url?: string };
  /** Compare the working tree (the checkout with its uncommitted changes, untracked files included) instead of a commit. */
  worktree?: boolean;
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
  const asked = opts.worktree ? "HEAD" : (opts.request ?? opts.head ?? "HEAD");
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
  // the working tree is scanned where it is (it's the checkout); commits from their exported copies
  const [baseTree, headTree, changes, baseInfo, headInfo] = await Promise.all([
    exportCommit(repo.root, compared, opts.treesDir),
    opts.worktree ? Promise.resolve(repo.root) : exportCommit(repo.root, headSha, opts.treesDir),
    changedFiles(repo.root, compared, opts.worktree ? undefined : headSha),
    commitInfo(repo.root, baseTip),
    commitInfo(repo.root, headSha),
  ]);
  opts.signal?.throwIfAborted();

  const { base: _b, head: _h, request: _r, requestInfo, worktree: _w, against: _a, treesDir: _t, onStructure, ...scanOpts } = opts;
  // progress counts follow the head's scan (the one the UI waits on)
  const base = await scanStructure(at(baseTree), { ...scanOpts, types: false, onCount: undefined });
  const head = await scanStructure(at(headTree), { ...scanOpts, types: false });

  // changed files under the scanned folder, relative to it
  const prefix = sub ? `${sub}/` : "";
  const inside = (p: string) => !prefix || p.startsWith(prefix);
  const files = changes
    .filter((f) => inside(f.path) || (f.from && inside(f.from)))
    .map((f) => ({ ...f, path: f.path.slice(prefix.length), from: f.from?.slice(prefix.length) }));

  const sides = {
    base: { ref: baseRef, sha: baseTip, subject: baseInfo.subject },
    head: {
      ref: headRef,
      sha: headSha,
      subject: opts.worktree ? "uncommitted changes" : headInfo.subject,
      ...(opts.worktree ? { worktree: true } : {}),
      ...(requestOf(opts.request, requestInfo) ?? {}),
    },
    against,
    compared,
  };
  const diff = diffSnapshots(base.snapshot, head.snapshot, files, sides);

  // the project's paths: the checkout when it is the head, else the exported copy (what the head has)
  const headRoot = at(headTree);
  const finish = (s: Snapshot, d: SnapshotDiff): Snapshot => {
    if (headSha === repo.head && !opts.worktree) for (const n of Object.values(s.nodes)) if (n.absPath?.startsWith(headRoot)) n.absPath = dir + n.absPath.slice(headRoot.length);
    return { ...s, rootDir: dir, diff: d };
  };
  const structure = finish(head.snapshot, diff);
  onStructure?.(structure);
  if (opts.types === false) return structure;
  // both sides typed (the base too: inferred types — return types without an annotation — can then
  // be compared); what changed is decided by source hashes, so only `before` / `removed` gain types
  const [typedHead, typedBase] = await Promise.all([
    addTypes(head, scanOpts),
    addTypes(base, { ...scanOpts, onCount: undefined, onProgress: undefined }).catch(() => base.snapshot),
  ]);
  return finish(typedHead, diffSnapshots(typedBase, typedHead, files, sides));
}

/** A request ref as the diff's `head.request`: its number and host, with the CLI's title, author, link. */
function requestOf(ref: string | undefined, info: DiffScanOptions["requestInfo"]): { request: NonNullable<SnapshotDiff["head"]["request"]> } | undefined {
  const m = ref?.match(/^refs\/(pull|merge-requests)\/(\d+)\/head$/);
  if (!m) return undefined;
  return { request: { number: Number(m[2]), provider: m[1] === "pull" ? "github" : "gitlab", ...info } };
}
