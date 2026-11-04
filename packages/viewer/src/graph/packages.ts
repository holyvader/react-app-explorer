import type { GraphNode } from "@rae/schema";
import { isChangedAsset, isGhost } from "../lib/diff.ts";

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
  /** Show the project's asset files (CSS, images, JSON); hidden by default (a diff's changed ones show with its overlay). */
  showAssets?: boolean;
  /** Diff overlay off: what only the base had (removed nodes) is hidden. */
  hideRemoved?: boolean;
}

/** A non-code project file: `asset` module nodes (and `asset:` externals in old snapshots). */
export const isAsset = (node: GraphNode | undefined) => !!node && (node.asset === true || node.id.startsWith("asset:"));

/** Whether a node is hidden by the filter: a 3rd-party library the user hid, or an asset while assets are off. */
export function isFiltered(node: GraphNode | undefined, filter: LibraryFilter): boolean {
  if (!node) return false;
  if (filter.hideRemoved && isGhost(node)) return true;
  // with the diff overlay on, the assets the diff touched show (and connect) like code does
  if (isAsset(node)) return !filter.showAssets && !(!filter.hideRemoved && isChangedAsset(node));
  if (node.kind !== "external") return false;
  return filter.hideAll || filter.excluded.has(packageOf(node.filePath));
}
