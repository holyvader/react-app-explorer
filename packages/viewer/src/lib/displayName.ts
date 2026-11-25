import type { GraphNode } from "@rae/schema";

const INDEX_FILE = /^index\.[cm]?[jt]sx?$/;

/**
 * The folder an `index.ts(x)` file stands for: `src/components/TestComponent/index.tsx` →
 * `TestComponent`. Only for file nodes (not a declaration merged into its file, which has its own
 * name); undefined for any other file and for an index at the project root.
 */
export function indexFolderOf(node: Pick<GraphNode, "kind" | "filePath">): string | undefined {
  if (node.kind !== "module") return undefined;
  const parts = node.filePath.split("/");
  if (parts.length < 2 || !INDEX_FILE.test(parts[parts.length - 1]!)) return undefined;
  return parts[parts.length - 2];
}

/**
 * The name to show for a node: an index file by its folder (shown with an `index` badge, see
 * `indexFolderOf`), and an index file's default export `index (default)` in snapshots scanned before
 * the scanner named it after the folder.
 */
export function displayName(node: Pick<GraphNode, "kind" | "name" | "filePath">): string {
  const folder = indexFolderOf(node);
  if (folder) return folder;
  if (node.name === "index (default)") {
    const parts = node.filePath.split("/");
    if (parts.length >= 2 && INDEX_FILE.test(parts[parts.length - 1]!)) return `${parts[parts.length - 2]} (default)`;
  }
  return node.name;
}
