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
  /** Hide every 3rd-party package. */
  hideAll: boolean;
  /** Show the project's asset files (CSS, images, JSON); hidden by default. */
  showAssets?: boolean;
}

/** A non-code project file: `asset` module nodes (and `asset:` externals in old snapshots). */
export const isAsset = (node: GraphNode | undefined) => !!node && (node.asset === true || node.id.startsWith("asset:"));

/** Whether a node is hidden by the filter: a 3rd-party library the user hid, or an asset while assets are off. */
export function isFiltered(node: GraphNode | undefined, filter: LibraryFilter): boolean {
  if (!node) return false;
  if (isAsset(node)) return !filter.showAssets;
  if (node.kind !== "external") return false;
  return filter.hideAll || filter.excluded.has(packageOf(node.filePath));
}
