import type { SelectOption } from "@rae/design-system";
import type { GitOverview } from "@rae/schema";

/** A branch name's kind of work: `feat/login` → `feat/`, `origin/fix/x` → `fix/` (none for `main`). */
export const branchPrefix = (name: string, remote?: boolean): string | undefined => {
  const own = remote ? name.slice(name.indexOf("/") + 1) : name;
  const slash = own.indexOf("/");
  return slash > 0 ? own.slice(0, slash + 1) : undefined;
};

/**
 * Branches as grouped options: local ones first (plain names — main, develop… — then a group per
 * prefix: `feat/`, `fix/`…, alphabetically), then the remote ones the same way.
 */
export function branchOptions(branches: GitOverview["branches"], value: (name: string) => string): SelectOption[] {
  const rows = branches.map((b) => ({ b, prefix: branchPrefix(b.name, b.remote) }));
  rows.sort((x, y) => Number(!!x.b.remote) - Number(!!y.b.remote) || Number(!!x.prefix) - Number(!!y.prefix) || (x.prefix ?? "").localeCompare(y.prefix ?? "") || x.b.name.localeCompare(y.b.name));
  return rows.map(({ b, prefix }) => {
    const remote = b.remote ? b.name.slice(0, b.name.indexOf("/") + 1) : "";
    return {
      value: value(b.name),
      label: b.name,
      // in a prefix group (`origin/feat`) the row is the rest of the name: `login-page`, `ui/` **nav**
      parts: prefix ? branchParts(b.name.slice(remote.length + prefix.length)) : branchParts(b.name, b.remote),
      detailLead: b.author,
      detail: b.subject,
      group: prefix ? prefixGroup(prefix, remote) : b.remote ? "Remote branches" : "Branches",
    };
  });
}

/** A row of a prefix group: the item, and its name without the group's prefix. */
export interface GroupRow<T> {
  item: T;
  rest: string;
}

/**
 * Items named by a branch (branches, pull requests by their branch) in groups by that branch's
 * prefix: plain names first (`plain`), then `feat`, `fix`… alphabetically; then the remote ones the
 * same way (`origin`, `origin/feat`…). Each row keeps the rest of the name (`login-page`); the full
 * name is still what a search matches, so `feat/login` finds it. Within a group, the items' order.
 */
export function groupByPrefix<T>(items: readonly T[], nameOf: (t: T) => string | undefined, remoteOf: (t: T) => boolean, plain: (remote: boolean) => string): { label: string; rows: GroupRow<T>[] }[] {
  const groups = new Map<string, { label: string; rank: string; rows: GroupRow<T>[] }>();
  for (const item of items) {
    const name = nameOf(item) ?? "";
    const remote = remoteOf(item);
    const lead = remote ? name.slice(0, name.indexOf("/") + 1) : "";
    const prefix = branchPrefix(name, remote);
    const label = prefix ? prefixGroup(prefix, lead) : plain(remote);
    // local before remote; within each, plain names before prefixes, prefixes A to Z
    const rank = `${remote ? 1 : 0}${prefix ? `1${prefix}` : "0"}`;
    const g = groups.get(label) ?? { label, rank, rows: [] };
    g.rows.push({ item, rest: name.slice(lead.length + (prefix?.length ?? 0)) || name });
    groups.set(label, g);
  }
  return [...groups.values()].sort((a, b) => a.rank.localeCompare(b.rank));
}

/** A prefix group's label: `feat`, `origin/feat`. */
export const prefixGroup = (prefix: string, remote = "") => `${remote}${prefix.replace(/\/$/, "")}`;

/**
 * A branch name in parts for a list row: the remote (`origin/`) quiet, its own name's last part
 * (after the last `/`) bold: `origin/` `feat/` **login-page**.
 */
export function branchParts(name: string, remote?: boolean): { text: string; tone?: "dim" | "strong" }[] {
  const at = remote ? name.indexOf("/") + 1 : 0;
  const own = name.slice(at);
  const last = own.lastIndexOf("/") + 1;
  return [
    ...(at ? [{ text: name.slice(0, at), tone: "dim" as const }] : []),
    ...(last ? [{ text: own.slice(0, last) }] : []),
    { text: own.slice(last), tone: "strong" as const },
  ];
}

/** A remote as a short place: `github.com/owner/repo` (from https, ssh or scp-like URLs). */
export const remoteLabel = (url: string) =>
  url
    .replace(/^[a-z+]+:\/\//, "")
    .replace(/^[^@/]+@/, "")
    .replace(/^([^/:]+):(?!\d)/, "$1/")
    .replace(/\.git$/, "");
