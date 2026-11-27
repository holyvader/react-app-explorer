import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { GitRequest, GitToolStatus, RequestSource, ReviewThread } from "@rae/schema";

/*
 * Optional: the GitHub CLI (`gh`) and GitLab CLI (`glab`), for what git doesn't know about pull /
 * merge requests — title, author, draft, target branch, link — and to list open ones only. They're
 * asked for the list only: commits are still fetched with plain git (refs/pull/N/head,
 * refs/merge-requests/N/head), so the repo isn't changed. They use their own logins: no token is
 * read here. Commands run without a shell, user input never becomes an option.
 */

export type HostTool = "gh" | "glab";

const ENV_OVERRIDE: Record<HostTool, string> = { gh: "RAE_GH", glab: "RAE_GLAB" };
const found = new Map<HostTool, string | null>();

/** Where `gh` / `glab` is: `RAE_GH` / `RAE_GLAB`, Homebrew (apps from the Finder get a bare PATH), PATH. Null when missing. */
export function toolPath(tool: HostTool): string | null {
  if (found.has(tool)) return found.get(tool)!;
  const exe = process.platform === "win32" ? `${tool}.exe` : tool;
  const env = process.env[ENV_OVERRIDE[tool]];
  const candidates = [
    ...(env ? [env] : []),
    ...(process.platform === "darwin" ? [`/opt/homebrew/bin/${tool}`, `/usr/local/bin/${tool}`] : []),
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean).map((d) => join(d, exe)),
    ...(process.platform === "linux" ? [`/usr/bin/${tool}`, `/snap/bin/${tool}`, `/home/linuxbrew/.linuxbrew/bin/${tool}`] : []),
  ];
  const path = candidates.find((p) => existsSync(p)) ?? null;
  found.set(tool, path);
  return path;
}

/** Forgets where the tools are (tests, or after the user installed one). */
export const resetToolPaths = () => found.clear();

class ToolError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

function run(tool: HostTool, args: string[], cwd: string, timeoutMs = 20_000): Promise<string> {
  const bin = toolPath(tool);
  if (!bin) return Promise.reject(new ToolError(`${tool} isn't installed`));
  return new Promise((ok, fail) => {
    execFile(
      bin,
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        // never prompt, never page, never check for updates, plain output
        env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_PAGER: "", NO_COLOR: "1", NO_PROMPT: "1", GLAB_CHECK_UPDATE: "false", GLAB_NO_PROMPT: "1", PAGER: "cat" },
      },
      (err, stdout, stderr) => {
        if (!err) return ok(String(stdout));
        const msg = err.killed ? `${tool} timed out` : (String(stderr).trim().split("\n").find(Boolean) ?? `${tool} failed`);
        fail(new ToolError(msg, typeof err.code === "number" ? err.code : undefined));
      },
    );
  });
}

/** The host and project path of a remote URL: `https://github.com/a/b.git`, `git@gitlab.com:g/s/p.git`, `ssh://git@host:22/a/b`. */
export function remoteRepo(url: string): { host: string; path: string } | undefined {
  const scp = url.match(/^[\w.-]+@([^:/]+):(.+?)(?:\.git)?\/?$/);
  if (scp) return { host: scp[1]!.toLowerCase(), path: scp[2]! };
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/+/, "").replace(/\.git\/?$/, "").replace(/\/+$/, "");
    return u.hostname && path ? { host: u.hostname.toLowerCase(), path } : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a tool is installed and logged in for `host` (`gh auth status --hostname`, `glab auth status --hostname`). */
export async function toolStatus(tool: HostTool, host: string | undefined, cwd: string): Promise<GitToolStatus> {
  const path = toolPath(tool);
  if (!path) return { installed: false };
  const version = await run(tool, ["--version"], cwd, 5_000).then(
    (s) => s.match(/\d+\.\d+(\.\d+)?/)?.[0],
    () => undefined,
  );
  if (!host) return { installed: true, path, version, authed: false, error: "No origin remote to log in to" };
  // glab prints its status to stderr and exits non-zero when not logged in; gh likewise
  const authed = await run(tool, ["auth", "status", "--hostname", host], cwd, 15_000).then(
    () => true,
    () => false,
  );
  return { installed: true, path, version, authed, ...(authed ? {} : { error: `${tool} isn't logged in to ${host}: run \`${tool} auth login --hostname ${host}\`` }) };
}

interface GhPr {
  number: number;
  title: string;
  author?: { login?: string };
  headRefOid: string;
  headRefName?: string;
  baseRefName?: string;
  isDraft?: boolean;
  url?: string;
  updatedAt?: string;
}

/** Open pull requests, newest first, from `gh pr list` (the repo named explicitly: `-R host/owner/repo`). */
export async function listViaGh(root: string, remote: { host: string; path: string }, limit = 100): Promise<GitRequest[]> {
  const out = await run("gh", ["pr", "list", "-R", `${remote.host}/${remote.path}`, "--state", "open", "--limit", String(limit), "--json", "number,title,author,headRefOid,headRefName,baseRefName,isDraft,url,updatedAt"], root);
  const list = JSON.parse(out) as GhPr[];
  return list
    .filter((p) => Number.isInteger(p.number) && typeof p.headRefOid === "string")
    .map((p) => ({
      number: p.number,
      provider: "github" as const,
      ref: `refs/pull/${p.number}/head`,
      sha: p.headRefOid,
      title: p.title,
      author: p.author?.login,
      headBranch: p.headRefName,
      baseBranch: p.baseRefName,
      draft: !!p.isDraft,
      state: "open" as const,
      url: p.url,
      updatedAt: p.updatedAt,
      source: "gh" as const,
    }));
}
interface GlabMr {
  iid: number;
  title: string;
  author?: { username?: string };
  sha: string;
  source_branch?: string;
  target_branch?: string;
  draft?: boolean;
  work_in_progress?: boolean;
  web_url?: string;
  updated_at?: string;
}

/** Open merge requests, newest first, from `glab mr list` (the project named by its URL: self-hosted GitLab works). */
export async function listViaGlab(root: string, remote: { host: string; path: string }, limit = 100): Promise<GitRequest[]> {
  const out = await run("glab", ["mr", "list", "-R", `https://${remote.host}/${remote.path}`, "--per-page", String(limit), "--output", "json"], root);
  const list = JSON.parse(out) as GlabMr[];
  return list
    .filter((m) => Number.isInteger(m.iid) && typeof m.sha === "string")
    .map((m) => ({
      number: m.iid,
      provider: "gitlab" as const,
      ref: `refs/merge-requests/${m.iid}/head`,
      sha: m.sha,
      title: m.title,
      author: m.author?.username,
      headBranch: m.source_branch,
      baseBranch: m.target_branch,
      draft: !!(m.draft ?? m.work_in_progress),
      state: "open" as const,
      url: m.web_url,
      updatedAt: m.updated_at,
      source: "glab" as const,
    }));
}

/** The tool Auto would use for a remote: gh for GitHub hosts, glab for GitLab hosts; for others, whichever is logged in there. */
export function toolFor(provider: "github" | "gitlab" | undefined): HostTool[] {
  return provider === "github" ? ["gh"] : provider === "gitlab" ? ["glab"] : ["gh", "glab"];
}

export const SOURCES: readonly RequestSource[] = ["auto", "git", "gh", "glab"];

// ---- review comments ------------------------------------------------------------------------------

/** A thread as the host has it: its path relative to the repository root. */
export type HostThread = Omit<ReviewThread, "path"> & { path: string };

const GH_THREADS = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line originalLine diffSide
          comments(first: 50) { nodes { author { login } body createdAt url } }
        }
      }
    }
  }
}`;

interface GhThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  diffSide: "LEFT" | "RIGHT";
  comments: { nodes: { author?: { login?: string } | null; body: string; createdAt?: string; url?: string }[] };
}

/** A pull request's review threads (`gh api graphql`: resolved state included), up to 500. */
export async function reviewViaGh(root: string, remote: { host: string; path: string }, number: number): Promise<HostThread[]> {
  const [owner, ...rest] = remote.path.split("/");
  const out: HostThread[] = [];
  let after: string | undefined;
  for (let page = 0; page < 5; page++) {
    const args = ["api", "graphql", "--hostname", remote.host, "-f", `query=${GH_THREADS}`, "-f", `owner=${owner}`, "-f", `name=${rest.join("/")}`, "-F", `number=${number}`];
    if (after) args.push("-f", `after=${after}`);
    const res = JSON.parse(await run("gh", args, root, 30_000)) as {
      data?: { repository?: { pullRequest?: { reviewThreads?: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: GhThread[] } } } };
    };
    const threads = res.data?.repository?.pullRequest?.reviewThreads;
    if (!threads) break;
    for (const t of threads.nodes) {
      out.push({
        id: t.id,
        path: t.path,
        line: t.line ?? undefined,
        side: t.diffSide === "LEFT" ? "old" : "new",
        resolved: t.isResolved,
        outdated: t.isOutdated || t.line === null,
        comments: t.comments.nodes.map((c) => ({ author: c.author?.login, body: c.body, createdAt: c.createdAt, url: c.url })),
      });
    }
    if (!threads.pageInfo.hasNextPage) break;
    after = threads.pageInfo.endCursor;
  }
  return out;
}

interface GlabNote {
  id: number;
  body: string;
  system?: boolean;
  author?: { username?: string };
  created_at?: string;
  resolvable?: boolean;
  resolved?: boolean;
  position?: { new_path?: string; old_path?: string; new_line?: number | null; old_line?: number | null } | null;
}

/** A merge request's line discussions (`glab api …/discussions`), up to 500; `url` is the request's page, each note gets its anchor. */
export async function reviewViaGlab(root: string, remote: { host: string; path: string }, iid: number, url?: string): Promise<HostThread[]> {
  const project = encodeURIComponent(remote.path);
  const out: HostThread[] = [];
  for (let page = 1; page <= 5; page++) {
    const list = JSON.parse(await run("glab", ["api", "--hostname", remote.host, `projects/${project}/merge_requests/${iid}/discussions?per_page=100&page=${page}`], root, 30_000)) as { id: string; notes: GlabNote[] }[];
    for (const d of list) {
      const notes = d.notes.filter((n) => !n.system);
      const first = notes[0];
      const pos = first?.position;
      if (!first || !pos) continue; // general comments: not on a line
      const onNew = pos.new_line != null;
      out.push({
        id: d.id,
        path: (onNew ? pos.new_path : pos.old_path) ?? pos.new_path ?? pos.old_path ?? "",
        line: (onNew ? pos.new_line : pos.old_line) ?? undefined,
        side: onNew ? "new" : "old",
        resolved: notes.every((n) => !n.resolvable || n.resolved),
        comments: notes.map((n) => ({ author: n.author?.username, body: n.body, createdAt: n.created_at, url: url ? `${url}#note_${n.id}` : undefined })),
      });
    }
    if (list.length < 100) break;
  }
  return out;
}
