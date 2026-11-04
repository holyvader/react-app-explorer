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
  return rows.map(({ b, prefix }) => ({
    value: value(b.name),
    label: `${b.name} — ${b.subject.slice(0, 60)}`,
    group: prefix ? `${b.remote ? `${b.name.slice(0, b.name.indexOf("/"))} · ` : ""}${prefix}` : b.remote ? "Remote branches" : "Branches",
  }));
}
