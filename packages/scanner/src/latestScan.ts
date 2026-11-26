import { realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Snapshot } from "@rae/schema";
import { commitInfo, exportCommit, fetchBranch, git, GitError, isBranchName, repoOf } from "./git.ts";

/** A local branch's newest commit, or null when there's no such branch. */
async function localBranchSha(root: string, branch: string): Promise<string | null> {
  return git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`])
    .then((s) => s.trim() || null)
    .catch(() => null);
}

/** Where the latest commit was exported, and how to turn its snapshot back into the project's. */
export interface LatestTree {
  /** The scanned folder inside the exported commit. */
  path: string;
  commit: NonNullable<Snapshot["commit"]>;
  /** The snapshot as the project's: `rootDir` the folder asked for, the commit recorded, paths into the checkout when it is that commit. */
  finish: (s: Snapshot) => Snapshot;
}

/**
 * "Read the latest": fetches the newest commit of a branch — origin's default one, or `branch`
 * (`feat/x`, or `origin/feat/x`) — and exports it to a folder of its own (like diff mode), so the
 * checkout, its branch and uncommitted work are never touched. A local branch origin doesn't have
 * is read as it is here.
 */
export async function latestTree(input: string, opts: { branch?: string; treesDir?: string; onProgress?: (m: string) => void; signal?: AbortSignal } = {}): Promise<LatestTree> {
  const dir = realpathSync(input);
  const repo = await repoOf(dir);
  if (!repo) throw new GitError(`Not in a git repository: ${dir}`);
  const asked = opts.branch?.replace(/^origin\//, "");
  if (asked !== undefined && !isBranchName(asked)) throw new GitError(`Not a branch name: ${opts.branch}`);
  if (!repo.remote && !asked) throw new GitError("The repository has no origin remote to fetch the latest from");
  const branch = asked ?? repo.defaultBranch;
  if (!branch) throw new GitError("origin has no default branch (no origin/HEAD, main or master)");
  opts.onProgress?.(`fetching origin/${branch}`);
  let ref = `origin/${branch}`;
  let sha: string;
  try {
    if (!repo.remote) throw new GitError("no origin");
    sha = await fetchBranch(repo.root, branch);
  } catch (e) {
    // a branch only here (or no origin): its local tip
    if (!asked) throw e;
    const local = await localBranchSha(repo.root, branch);
    if (!local) throw e;
    sha = local;
    ref = branch;
  }
  opts.signal?.throwIfAborted();
  const [tree, info] = await Promise.all([exportCommit(repo.root, sha, opts.treesDir), commitInfo(repo.root, sha)]);
  const sub = relative(repo.root, dir).split(sep).join("/");
  const path = sub ? join(tree, sub) : tree;
  const commit = { ref, sha, subject: info.subject, date: info.date };
  const finish = (s: Snapshot): Snapshot => {
    // the checkout is that very commit: open files from it rather than from the exported copy
    // (copies: the type pass still reads the structure scan's nodes)
    const nodes = sha !== repo.head ? s.nodes : Object.fromEntries(Object.entries(s.nodes).map(([id, n]) => [id, n.absPath?.startsWith(path) ? { ...n, absPath: dir + n.absPath.slice(path.length) } : n]));
    const entry = s.entry.startsWith(path) ? dir + s.entry.slice(path.length) : s.entry;
    return { ...s, rootDir: dir, entry, commit, nodes };
  };
  return { path, commit, finish };
}
