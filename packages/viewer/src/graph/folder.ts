import type { GraphNode, NodeKind, Snapshot } from "@rae/schema";
import { FOLDER_PREFIX } from "./drawn.ts";

/** What a folder holds in the scanned model (not just what's drawn). */
export interface FolderContents {
  path: string;
  /** File modules anywhere under the folder. */
  files: GraphNode[];
  /** Declarations (components, hooks, functions, actions) in those files. */
  declarations: GraphNode[];
  /** Direct subfolders with how many scanned elements each holds. */
  subfolders: { path: string; name: string; count: number }[];
  /** Files directly in this folder (not in a subfolder). */
  directFiles: GraphNode[];
  countsByKind: Partial<Record<NodeKind, number>>;
}

export const folderPath = (id: string) => id.slice(FOLDER_PREFIX.length);

export function folderContents(s: Snapshot, path: string): FolderContents {
  const prefix = path + "/";
  const files: GraphNode[] = [];
  const declarations: GraphNode[] = [];
  const directFiles: GraphNode[] = [];
  const sub = new Map<string, number>();
  const countsByKind: Partial<Record<NodeKind, number>> = {};
  for (const n of Object.values(s.nodes)) {
    if (n.kind === "external" || !n.filePath.startsWith(prefix)) continue;
    countsByKind[n.kind] = (countsByKind[n.kind] ?? 0) + 1;
    // a declaration standing for its file (merged scan) counts as both
    if (n.kind === "module" || n.file) files.push(n);
    if (n.kind !== "module") declarations.push(n);
    const rest = n.filePath.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) {
      if (n.kind === "module" || n.file) directFiles.push(n);
    } else {
      const name = rest.slice(0, slash);
      sub.set(name, (sub.get(name) ?? 0) + 1);
    }
  }
  const byPath = (a: GraphNode, b: GraphNode) => a.filePath.localeCompare(b.filePath);
  return {
    path,
    files: files.sort(byPath),
    declarations,
    directFiles: directFiles.sort(byPath),
    subfolders: [...sub].map(([name, count]) => ({ name, path: `${path}/${name}`, count })).sort((a, b) => a.name.localeCompare(b.name)),
    countsByKind,
  };
}

/** Ids to add for "show files inside" (deep = false) or "show everything inside" (files + declarations). */
export function folderExpansion(s: Snapshot, path: string, deep: boolean): string[] {
  const c = folderContents(s, path);
  return deep ? [...new Set([...c.files, ...c.declarations].map((n) => n.id))] : c.files.map((n) => n.id);
}

/** A folder's parent folder id (`dir:a/b` → `dir:a`), or all of its ancestors up to the project root. */
export function parentFolders(id: string, all: boolean): string[] {
  const out: string[] = [];
  let path = folderPath(id);
  for (let slash = path.lastIndexOf("/"); slash > 0; slash = path.lastIndexOf("/")) {
    path = path.slice(0, slash);
    out.push(`${FOLDER_PREFIX}${path}`);
    if (!all) break;
  }
  return out;
}
