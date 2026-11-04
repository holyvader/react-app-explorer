import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

/*
 * Git, through plain `git` commands only (no GitHub / GitLab CLI): the repo a folder is in, its
 * branches, open pull / merge requests (the refs GitHub and GitLab publish: refs/pull/N/head,
 * refs/merge-requests/N/head), the merge-base, changed files, and a commit's files exported to a
 * folder for scanning. Nothing here changes the user's repo: no checkout, no worktree, no refs.
 */

export class GitError extends Error {}

/** Runs git in `cwd`; resolves to stdout, rejects with git's message. Arguments are passed as a list, never through a shell. */
export async function git(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env }, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new GitError(err.trim() || `git ${args[0]} failed (${code})`);
  return out;
}

export interface RepoInfo {
  /** The repo's top folder (real path). */
  root: string;
  /** The checked-out commit and branch (undefined when detached). */
  head: string;
  branch?: string;
  /** origin's default branch (`origin/HEAD`), else `main` / `master` when they exist. */
  defaultBranch?: string;
  /** Where origin points, and which host publishes its pull / merge request refs. */
  remote?: { name: string; url: string; provider?: "github" | "gitlab" };
}

/** The git repo `dir` is in, or undefined when it isn't in one. */
export async function repoOf(dir: string): Promise<RepoInfo | undefined> {
  let root: string;
  try {
    root = realpathSync((await git(dir, ["rev-parse", "--show-toplevel"])).trim());
  } catch {
    return undefined;
  }
  const [head, branch, originHead, url] = await Promise.all([
    git(root, ["rev-parse", "HEAD"]).then((s) => s.trim(), () => ""),
    git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).then((s) => s.trim() || undefined, () => undefined),
    git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).then((s) => s.trim() || undefined, () => undefined),
    git(root, ["remote", "get-url", "origin"]).then((s) => s.trim() || undefined, () => undefined),
  ]);
  let defaultBranch = originHead?.replace(/^origin\//, "");
  if (!defaultBranch) {
    for (const name of ["main", "master"]) {
      if (await resolveRef(root, name).then(() => true, () => false)) {
        defaultBranch = name;
        break;
      }
    }
  }
  const provider = url ? (/github/i.test(url) ? "github" : /gitlab/i.test(url) ? "gitlab" : undefined) : undefined;
  return { root, head, branch, defaultBranch, remote: url ? { name: "origin", url, provider } : undefined };
}

/** A ref (branch, tag, sha, `HEAD~2`…) → its commit sha. Rejects refs that aren't commits. */
export async function resolveRef(root: string, ref: string): Promise<string> {
  if (!ref || ref.startsWith("-")) throw new GitError(`Not a ref: ${ref}`);
  return (await git(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]).catch(() => {
    throw new GitError(`Unknown ref: ${ref}`);
  })).trim();
}

export const mergeBase = async (root: string, a: string, b: string) => (await git(root, ["merge-base", a, b])).trim();

export async function commitInfo(root: string, sha: string): Promise<{ subject: string; date: string; author: string }> {
  const [subject = "", date = "", author = ""] = (await git(root, ["log", "-1", "--format=%s%x00%cI%x00%an", sha])).trim().split("\0");
  return { subject, date, author };
}

export interface BranchRef {
  name: string;
  /** Full ref: refs/heads/x or refs/remotes/origin/x. */
  ref: string;
  sha: string;
  remote: boolean;
  subject: string;
  date: string;
}

/** Local and remote-tracking branches, most recent commit first. */
export async function listBranches(root: string): Promise<BranchRef[]> {
  const out = await git(root, ["for-each-ref", "--sort=-committerdate", "--format=%(refname)%00%(refname:short)%00%(objectname)%00%(contents:subject)%00%(committerdate:iso-strict)", "refs/heads", "refs/remotes"]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref = "", name = "", sha = "", subject = "", date = ""] = line.split("\0");
      return { ref, name, sha, subject, date, remote: ref.startsWith("refs/remotes/") };
    })
    .filter((b) => !b.ref.endsWith("/HEAD"));
}

export interface RequestRef {
  /** `!12` style number. */
  number: number;
  provider: "github" | "gitlab";
  /** The remote ref: refs/pull/12/head or refs/merge-requests/12/head. */
  ref: string;
  sha: string;
}

/**
 * Open pull / merge requests, from the refs the host publishes (`git ls-remote`, a network call).
 * GitHub keeps refs/pull/N/head, GitLab refs/merge-requests/N/head. Closed ones stay listed by the
 * host for a while, and titles aren't in git: label them by their head commit once fetched.
 */
export async function listRequests(root: string, remote = "origin"): Promise<RequestRef[]> {
  const out = await git(root, ["ls-remote", remote, "refs/pull/*/head", "refs/merge-requests/*/head"]);
  const list: RequestRef[] = [];
  for (const line of out.split("\n")) {
    const [sha, ref] = line.split("\t");
    const m = ref?.match(/^refs\/(pull|merge-requests)\/(\d+)\/head$/);
    if (sha && m) list.push({ number: Number(m[2]), provider: m[1] === "pull" ? "github" : "gitlab", ref: ref!, sha });
  }
  return list.sort((a, b) => b.number - a.number);
}

/** Fetches a pull / merge request's head commit (into FETCH_HEAD only: no branch or ref is created). Returns its sha. */
export async function fetchRequest(root: string, request: Pick<RequestRef, "ref">, remote = "origin"): Promise<string> {
  if (!/^refs\/(pull|merge-requests)\/\d+\/head$/.test(request.ref)) throw new GitError(`Not a request ref: ${request.ref}`);
  await git(root, ["fetch", "--quiet", "--no-tags", remote, request.ref]);
  return (await git(root, ["rev-parse", "FETCH_HEAD^{commit}"])).trim();
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export interface FileChange {
  /** Path relative to the repo root (the new one for renames). */
  path: string;
  status: FileStatus;
  /** Renamed: the old path. */
  from?: string;
  additions: number;
  deletions: number;
}

/** Files changed between two commits, renames detected (`-M`), with line counts. */
export async function changedFiles(root: string, base: string, head: string): Promise<FileChange[]> {
  const [names, nums] = await Promise.all([
    git(root, ["diff", "-z", "-M", "--name-status", base, head]),
    git(root, ["diff", "-z", "-M", "--numstat", base, head]),
  ]);
  const files: FileChange[] = [];
  const parts = names.split("\0");
  for (let i = 0; i < parts.length && parts[i]; ) {
    const code = parts[i++]!;
    if (code.startsWith("R") || code.startsWith("C")) {
      const from = parts[i++]!;
      const path = parts[i++]!;
      files.push(code.startsWith("R") ? { path, from, status: "renamed", additions: 0, deletions: 0 } : { path, status: "added", additions: 0, deletions: 0 });
    } else {
      const path = parts[i++]!;
      files.push({ path, status: code === "A" ? "added" : code === "D" ? "deleted" : "modified", additions: 0, deletions: 0 });
    }
  }
  // numstat -z: "add\tdel\tpath\0", or for renames "add\tdel\t\0from\0to\0"; binary files count "-"
  const byPath = new Map(files.map((f) => [f.path, f]));
  const n = nums.split("\0");
  for (let i = 0; i < n.length && n[i]; ) {
    const [add = "0", del = "0", path = ""] = n[i++]!.split("\t");
    const target = path ? path : (i++, n[i++]!);
    const f = byPath.get(target);
    if (f) {
      f.additions = Number(add) || 0;
      f.deletions = Number(del) || 0;
    }
  }
  return files;
}

/**
 * A commit's files in a folder of their own, for scanning: a temporary index (`read-tree`) and
 * `checkout-index` into a cache folder per commit, reused while it exists. The repo's own
 * node_modules folders are linked in, so packages resolve (and types load) as in the checkout.
 */
export async function exportCommit(root: string, sha: string, cacheDir = join(tmpdir(), "rae-trees")): Promise<string> {
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new GitError(`Not a commit sha: ${sha}`);
  const dir = join(cacheDir, sha);
  if (existsSync(join(dir, ".rae-tree"))) return realpathSync(dir);
  mkdirSync(cacheDir, { recursive: true });
  const work = mkdtempSync(join(cacheDir, `${sha.slice(0, 12)}-`));
  try {
    const files = join(work, "files");
    const env = { GIT_INDEX_FILE: join(work, "index") };
    await git(root, ["read-tree", sha], env);
    await git(root, ["checkout-index", "--all", "--force", `--prefix=${files}/`], env);
    linkNodeModules(root, files);
    writeFileSync(join(files, ".rae-tree"), `${sha}\n`);
    rmSync(dir, { recursive: true, force: true });
    renameSync(files, dir);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return realpathSync(dir);
}

/**
 * Gives the exported tree the checkout's node_modules: every package is linked to the installed one,
 * except workspace packages (links into the repo itself, outside any node_modules), which point at the
 * exported tree's copy — so a monorepo's own packages are read as they are at that commit.
 */
function linkNodeModules(root: string, into: string) {
  const SKIP = new Set([".git", ".explorer", ".next", "dist", "build", "out", "coverage", ".turbo"]);
  const inRepo = (p: string) => p.startsWith(root + "/") && !p.includes("/node_modules/");
  const linkEntries = (from: string, to: string, scoped: boolean) => {
    mkdirSync(to, { recursive: true });
    for (const e of readdirSync(from, { withFileTypes: true })) {
      if (e.name === ".bin" || e.name === ".cache") continue;
      const src = join(from, e.name);
      const dst = join(to, e.name);
      if (existsSync(dst)) continue;
      if (!scoped && e.name.startsWith("@") && e.isDirectory()) {
        linkEntries(src, dst, true);
        continue;
      }
      let target = src;
      if (e.isSymbolicLink()) {
        try {
          target = realpathSync(src);
        } catch {
          continue; // a dangling link
        }
        // relative: the export is built in a temporary folder, then moved into place
        if (inRepo(target)) target = relative(to, join(into, relative(root, target)));
      }
      symlinkSync(target, dst, "dir");
    }
  };
  const walk = (dir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name)) continue;
      const path = join(dir, e.name);
      if (e.name === "node_modules") {
        const target = join(into, relative(root, path));
        if (existsSync(dirname(target))) linkEntries(path, target, false);
      } else if (depth < 4) walk(path, depth + 1);
    }
  };
  walk(root, 0);
}
