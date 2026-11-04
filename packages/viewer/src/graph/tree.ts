import type { Snapshot } from "@rae/schema";
import { isFiltered, type LibraryFilter } from "./packages.ts";

/*
 * The scanned model as a tree, for the picker: folders → files → their declarations, then the
 * libraries. Folder chains holding a single folder are one row (`src/components`), as on the canvas.
 */

export type TreeKind = "folder" | "file" | "decl" | "libraries" | "library" | "routes" | "route";

export interface TreeNode {
  key: string;
  kind: TreeKind;
  name: string;
  /** Path for folders/files, specifier for libraries. */
  path: string;
  /** Snapshot node id (files, declarations, libraries). */
  id?: string;
  /** A declaration standing for its whole file (merged scan): it sits where the file would, and its path matches. */
  file?: boolean;
  children: TreeNode[];
}

export function buildTree(s: Snapshot, filter: LibraryFilter): TreeNode[] {
  const root: TreeNode = { key: "dir:", kind: "folder", name: "", path: "", children: [] };
  const folders = new Map<string, TreeNode>([["", root]]);
  const folderFor = (dir: string): TreeNode => {
    const known = folders.get(dir);
    if (known) return known;
    const slash = dir.lastIndexOf("/");
    const parent = folderFor(slash < 0 ? "" : dir.slice(0, slash));
    const node: TreeNode = { key: `dir:${dir}`, kind: "folder", name: dir.slice(slash + 1), path: dir, children: [] };
    parent.children.push(node);
    folders.set(dir, node);
    return node;
  };

  const declsOf = new Map<string, TreeNode[]>();
  const libraries: TreeNode[] = [];
  for (const n of Object.values(s.nodes)) {
    if (n.kind === "external") {
      if (!n.id.startsWith("asset:") && !isFiltered(n, filter)) libraries.push({ key: n.id, kind: "library", name: n.name, path: n.filePath, id: n.id, children: [] });
    } else if (n.kind !== "module" && n.moduleId) {
      const list = declsOf.get(n.moduleId) ?? [];
      list.push({ key: n.id, kind: "decl", name: n.name, path: n.filePath, id: n.id, children: [] });
      declsOf.set(n.moduleId, list);
    }
  }
  for (const n of Object.values(s.nodes)) {
    if ((n.kind !== "module" && !n.file) || isFiltered(n, filter)) continue;
    const slash = n.filePath.lastIndexOf("/");
    const parent = slash < 0 || n.filePath.startsWith("..") ? root : folderFor(n.filePath.slice(0, slash));
    const decls = (declsOf.get(n.id) ?? []).sort((a, b) => (s.nodes[a.id!]?.loc?.line ?? 0) - (s.nodes[b.id!]?.loc?.line ?? 0));
    if (n.file) parent.children.push({ key: n.id, kind: "decl", name: n.name, path: n.filePath, id: n.id, file: true, children: [] });
    else parent.children.push({ key: n.id, kind: "file", name: n.name, path: n.filePath, id: n.id, children: decls });
  }

  const compress = (node: TreeNode): TreeNode => {
    let cur = node;
    while (cur.kind === "folder" && cur !== root && cur.children.length === 1 && cur.children[0]!.kind === "folder") {
      const only = cur.children[0]!;
      cur = { ...only, name: `${cur.name}/${only.name}` };
    }
    cur.children = cur.children.map(compress).sort((a, b) => (a.kind === "folder") === (b.kind === "folder") ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1);
    return cur;
  };
  const top = compress(root).children;
  // Next.js routes first, nested like the route tree (a route is an element of its own)
  const routeNodes = Object.values(s.nodes).filter((n) => n.kind === "route");
  if (routeNodes.length) {
    const rows = new Map(routeNodes.map((n) => [n.id, { key: n.id, kind: "route" as const, name: n.name, path: n.route?.url ?? n.name, id: n.id, children: [] as TreeNode[] }]));
    const roots: TreeNode[] = [];
    for (const n of routeNodes) {
      const parent = n.route?.parent ? rows.get(n.route.parent) : undefined;
      (parent ? parent.children : roots).push(rows.get(n.id)!);
    }
    const sortRoutes = (list: TreeNode[]) => {
      list.sort((a, b) => a.name.localeCompare(b.name));
      for (const r of list) sortRoutes(r.children);
    };
    sortRoutes(roots);
    top.unshift({ key: "routes", kind: "routes", name: "Routes", path: "", children: roots });
  }
  if (libraries.length) {
    top.push({ key: "libraries", kind: "libraries", name: "Libraries", path: "", children: libraries.sort((a, b) => a.name.localeCompare(b.name)) });
  }
  return top;
}

export interface TreeRow {
  node: TreeNode;
  depth: number;
  open: boolean;
}

/** Most rows rendered at once; refine the filter for more. */
export const MAX_ROWS = 400;

/**
 * Rows to show: without a query, what the open folders reveal; with one, every match with the
 * line of folders down to it (opened). `keep` hides nodes (e.g. already drawn in quick add).
 */
export function visibleRows(roots: TreeNode[], open: ReadonlySet<string>, query: string, keep: (n: TreeNode) => boolean = () => true) {
  const q = query.trim().toLowerCase();
  const rows: TreeRow[] = [];
  let truncated = false;
  const matches = (n: TreeNode) => !q || n.name.toLowerCase().includes(q) || ((n.kind !== "decl" || n.file) && n.path.toLowerCase().includes(q));
  // Whether a node or anything under it is shown.
  const memo = new Map<TreeNode, boolean>();
  const relevant = (n: TreeNode): boolean => {
    const known = memo.get(n);
    if (known !== undefined) return known;
    const below = n.children.some(relevant);
    const self = keep(n) && (matches(n) || (!!q && below));
    const r = n.children.length ? self || below : self;
    memo.set(n, r);
    return r;
  };
  // A node matching the query itself, or anything inside it doing so.
  const below = new Map<TreeNode, boolean>();
  const matchesBelow = (n: TreeNode): boolean => {
    const known = below.get(n);
    if (known !== undefined) return known;
    const r = (keep(n) && matches(n)) || n.children.some(matchesBelow);
    below.set(n, r);
    return r;
  };
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      if (rows.length >= MAX_ROWS) {
        truncated = true;
        return;
      }
      if (!relevant(n)) continue;
      // With a query, anything with matches inside opens, so they're all in sight.
      const isOpen = n.children.length > 0 && (open.has(n.key) || (!!q && n.children.some((c) => keep(c) && matchesBelow(c))));
      rows.push({ node: n, depth, open: isOpen });
      if (isOpen) walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return { rows, truncated };
}
