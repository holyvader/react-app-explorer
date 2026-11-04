import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { GitOverview, GitRequestList, GitTools, GitToolStatus, RequestSource } from "@rae/schema";
import { type HostTool, listViaGh, listViaGlab, remoteRepo, resetToolPaths, SOURCES, toolFor, toolStatus } from "./hostCli.ts";
import type { ScanDiffRequest } from "./job.ts";
import { git, GIT_MISSING, gitPath, listBranches, listRequests, repoOf } from "./git.ts";

export { gitPath };

/*
 * What the viewer's scan dialog asks about git (GET /api/git, /api/git/requests), shared by the
 * desktop app's server (Bun) and the Vite dev plugin (Node): plain git commands only.
 */


const folderOf = (path: string) => (existsSync(path) && statSync(path).isFile() ? dirname(path) : path);

export async function gitOverview(path: string): Promise<GitOverview> {
  if (!gitPath()) return { repo: null, branches: [], error: GIT_MISSING };
  try {
    const info = await repoOf(folderOf(path));
    if (!info) return { repo: null, branches: [] };
    const [branches, status] = await Promise.all([listBranches(info.root), git(info.root, ["status", "--porcelain", "--untracked-files=no"])]);
    return { repo: { ...info, dirty: status.trim().length > 0 }, branches: branches.slice(0, 300) };
  } catch (e) {
    return { repo: null, branches: [], error: (e as Error).message };
  }
}

/** Tool statuses, briefly remembered (`auth status` may ask the host): per tool and host. */
const statusCache = new Map<string, { at: number; status: GitToolStatus }>();
const STATUS_TTL = 60_000;
async function cachedStatus(tool: HostTool, host: string | undefined, cwd: string): Promise<GitToolStatus> {
  const key = `${tool}@${host ?? ""}`;
  const hit = statusCache.get(key);
  if (hit && Date.now() - hit.at < STATUS_TTL) return hit.status;
  const status = await toolStatus(tool, host, cwd);
  statusCache.set(key, { at: Date.now(), status });
  return status;
}
/** Forgets tool statuses and paths (after installing or logging in to one). */
export function refreshTools() {
  statusCache.clear();
  resetToolPaths();
}

/** The host CLIs for the folder's repo, and what Auto picks: the host's CLI when installed and logged in, else git. */
export async function gitTools(path: string): Promise<GitTools> {
  const info = await repoOf(folderOf(path)).catch(() => undefined);
  const remote = info?.remote ? remoteRepo(info.remote.url) : undefined;
  const cwd = info?.root ?? folderOf(path);
  const [ghStatus, glabStatus] = await Promise.all([cachedStatus("gh", remote?.host, cwd), cachedStatus("glab", remote?.host, cwd)]);
  const statuses = { gh: ghStatus, glab: glabStatus };
  const auto = toolFor(info?.remote?.provider).find((t) => statuses[t].installed && statuses[t].authed) ?? "git";
  return { host: remote?.host, gh: ghStatus, glab: glabStatus, auto };
}

/**
 * Pull / merge requests on origin. `git`: the refs the host publishes (`ls-remote`: open and closed,
 * no titles). `gh` / `glab`: open ones with title, author, target branch. `auto` (default): the
 * host's CLI when installed and logged in, else git — and git when the CLI fails (`fallback` says why).
 */
export async function gitRequests(path: string, source: RequestSource = "auto"): Promise<GitRequestList> {
  if (!SOURCES.includes(source)) return { requests: [], source: "git", error: `Unknown source: ${source}` };
  const viaGit = async (fallback?: string): Promise<GitRequestList> => {
    try {
      const info = await repoOf(folderOf(path));
      if (!info) return { requests: [], source: "git", error: "Not in a git repository", fallback };
      if (!info.remote) return { requests: [], source: "git", error: "No origin remote", fallback };
      return { requests: (await listRequests(info.root)).slice(0, 200).map((r) => ({ ...r, source: "git" as const })), source: "git", ...(fallback ? { fallback } : {}) };
    } catch (e) {
      return { requests: [], source: "git", error: (e as Error).message, fallback };
    }
  };
  if (source === "git") return viaGit();
  const info = await repoOf(folderOf(path)).catch(() => undefined);
  if (!info) return { requests: [], source: source === "auto" ? "git" : source, error: "Not in a git repository" };
  const remote = info.remote ? remoteRepo(info.remote.url) : undefined;
  if (!remote) return source === "auto" ? viaGit() : { requests: [], source, error: "No origin remote" };

  let tool: HostTool;
  if (source === "auto") {
    const tools = await gitTools(path);
    if (tools.auto === "git") {
      const wanted = toolFor(info.remote?.provider)[0]!;
      const why = tools[wanted].installed ? tools[wanted].error : `${wanted} isn't installed`;
      return viaGit(why);
    }
    tool = tools.auto;
  } else tool = source;

  try {
    const requests = tool === "gh" ? await listViaGh(info.root, remote) : await listViaGlab(info.root, remote);
    return { requests, source: tool };
  } catch (e) {
    const why = `${tool}: ${(e as Error).message}`;
    return source === "auto" ? viaGit(why) : { requests: [], source: tool, error: why };
  }
}

/** A pull / merge request's page (what the CLIs link to): https, and a PR / MR path — nothing else is opened. */
export function isRequestUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password && /^\/[^?#]+\/(pull|-\/merge_requests)\/\d+\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * A ref a UI may send: never an option (`-…`), no whitespace, control characters or the characters git
 * forbids in ref names (except `name~N`); whether it exists is checked when it's resolved.
 */
function isSafeRef(v: string): boolean {
  if (!v || v.length > 250 || v.startsWith("-")) return false;
  const tilde = v.match(/^([\w./-]+)~\d{1,4}$/);
  const name = tilde ? tilde[1]! : v;
  for (const ch of name) {
    const c = ch.charCodeAt(0);
    if (c <= 0x20 || c === 0x7f || "~^:?*[\\".includes(ch)) return false;
  }
  return !name.includes("..");
}

/** The `diff` of a scan request body, checked: undefined when absent; throws on anything malformed. */
export function parseDiffRequest(raw: unknown): ScanDiffRequest | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") throw new Error("diff must be an object");
  const d = raw as Record<string, unknown>;
  const ref = (k: string) => {
    const v = d[k];
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string" || !isSafeRef(v)) throw new Error(`Invalid ${k} ref`);
    return v;
  };
  const request = ref("request");
  if (request && !/^refs\/(pull|merge-requests)\/\d+\/head$/.test(request)) throw new Error("Invalid request ref");
  const against = d.against === "base" ? "base" : "merge-base";
  // what the CLI said about the request (shown, linked): plain strings, a request page link only
  let requestInfo: { title?: string; author?: string; url?: string } | undefined;
  if (request && d.requestInfo && typeof d.requestInfo === "object") {
    const r = d.requestInfo as Record<string, unknown>;
    // control characters become spaces
    const text = (v: unknown, max: number) => (typeof v === "string" && v ? [...v].map((c) => (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f ? " " : c)).join("").slice(0, max) : undefined);
    const url = typeof r.url === "string" && isRequestUrl(r.url) ? r.url : undefined;
    requestInfo = { title: text(r.title, 300), author: text(r.author, 100), url };
  }
  return { base: ref("base"), head: ref("head"), request, ...(requestInfo ? { requestInfo } : {}), ...(d.worktree === true ? { worktree: true } : {}), against };
}

/** Most of a file sent for a code diff (bigger ones are cut, and say so). */
const SOURCE_MAX = 2 * 1024 * 1024;

/**
 * A file's text at a commit (`git show <sha>:<path>`), or in the working tree (`sha` = "worktree"),
 * for the viewer's code diff. `file` is relative to the scanned folder `dir` (it may climb out of it,
 * like a workspace package's `../../packages/ui/x.tsx`) but must stay inside the repo.
 */
export async function gitSource(dir: string, sha: string, file: string): Promise<{ text: string; truncated?: boolean; missing?: boolean } | { error: string }> {
  if (sha !== "worktree" && !/^[0-9a-f]{40,64}$/.test(sha)) return { error: "Not a commit sha" };
  if (!file || file.includes("\0") || isAbsolute(file)) return { error: "Invalid file" };
  const info = await repoOf(folderOf(dir)).catch(() => undefined);
  if (!info) return { error: "Not in a git repository" };
  const abs = resolve(folderOf(dir), file);
  const rel = relative(info.root, abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return { error: "Outside the repository" };
  try {
    let text: string;
    if (sha === "worktree") {
      if (!existsSync(abs)) return { text: "", missing: true };
      text = readFileSync(abs, "utf8");
    } else {
      text = await git(info.root, ["show", `${sha}:${rel.split(sep).join("/")}`]).catch((e: Error) => {
        if (/does not exist|exists on disk, but not in/.test(e.message)) return "\0missing";
        throw e;
      });
      if (text === "\0missing") return { text: "", missing: true };
    }
    return text.length > SOURCE_MAX ? { text: text.slice(0, SOURCE_MAX), truncated: true } : { text };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
