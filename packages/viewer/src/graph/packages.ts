import type { GraphNode } from "@rae/schema";

/** Libraries hidden until the user opts in. */
export const DEFAULT_EXCLUDED = ["react", "react-dom"];

/** Package a bare specifier belongs to: `@scope/pkg/x` → `@scope/pkg`, `next/link` → `next`, `node:fs` → `node`. */
export function packageOf(specifier: string): string {
  if (specifier.startsWith("node:")) return "node";
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

export interface LibraryFilter {
  excluded: ReadonlySet<string>;
  /** Hide every 3rd-party package (assets stay). */
  hideAll: boolean;
}

/** Whether a node is a 3rd-party library hidden by the filter. Assets (local css/svg) are never filtered. */
export function isFiltered(node: GraphNode | undefined, filter: LibraryFilter): boolean {
  if (!node || node.kind !== "external" || node.id.startsWith("asset:")) return false;
  return filter.hideAll || filter.excluded.has(packageOf(node.filePath));
}
