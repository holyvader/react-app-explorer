import { existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { GitOverview, GitRequest } from "@rae/schema";
import { git, listBranches, listRequests, repoOf } from "./git.ts";

/*
 * What the viewer's scan dialog asks about git (GET /api/git, /api/git/requests), shared by the
 * desktop app's server (Bun) and the Vite dev plugin (Node): plain git commands only.
 */


const folderOf = (path: string) => (existsSync(path) && statSync(path).isFile() ? dirname(path) : path);

export async function gitOverview(path: string): Promise<GitOverview> {
  try {
    const info = await repoOf(folderOf(path));
    if (!info) return { repo: null, branches: [] };
    const [branches, status] = await Promise.all([listBranches(info.root), git(info.root, ["status", "--porcelain", "--untracked-files=no"])]);
    return { repo: { ...info, dirty: status.trim().length > 0 }, branches: branches.slice(0, 300) };
  } catch (e) {
    return { repo: null, branches: [], error: (e as Error).message };
  }
}

/** Open pull / merge requests on origin (a network call: asked for separately, it may be slow or fail offline). */
export async function gitRequests(path: string): Promise<{ requests: GitRequest[]; error?: string }> {
  try {
    const info = await repoOf(folderOf(path));
    if (!info) return { requests: [], error: "Not in a git repository" };
    if (!info.remote) return { requests: [], error: "No origin remote" };
    return { requests: (await listRequests(info.root)).slice(0, 200) };
  } catch (e) {
    return { requests: [], error: (e as Error).message };
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
export function parseDiffRequest(raw: unknown): { base?: string; head?: string; request?: string; against?: "merge-base" | "base" } | undefined {
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
  return { base: ref("base"), head: ref("head"), request, against };
}
