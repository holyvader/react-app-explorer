import type { Edge, GraphNode, NodeKind, Snapshot } from "@rae/schema";
import { isFiltered, type LibraryFilter } from "./packages.ts";
import { EDGE_GROUP_OF, type EnabledGroups, type GraphIndex } from "./relations.ts";

/**
 * What is drawn on the canvas, derived from the snapshot and the visible ids:
 * elements nested by containment (folder → file module → declarations) and the
 * relations between them as edges. Only what the user added is drawn: a declaration
 * sits inside its file module when that module is on the canvas too, else at the top
 * level (its nearest drawn container). Containment is drawn as nesting, never as an edge.
 */

export type DrawnKind = NodeKind | "folder";

export interface DrawnElement {
  id: string;
  kind: DrawnKind;
  name: string;
  /** Drawn container, null at the top level. */
  parent: string | null;
}

export interface DrawnRelation {
  id: string;
  source: string;
  target: string;
  edge: Edge;
}

export interface DrawnGraph {
  elements: DrawnElement[];
  relations: DrawnRelation[];
}

export const FOLDER_PREFIX = "dir:";
export const isFolder = (id: string) => id.startsWith(FOLDER_PREFIX);

export interface DrawOptions {
  enabled: EnabledGroups;
  filter: LibraryFilter;
  /** Draw folders as frames around file modules. */
  folders: boolean;
}

export function drawnGraph(snapshot: Snapshot, visible: readonly string[], opts: DrawOptions, index?: GraphIndex): DrawnGraph {
  const nodes = snapshot.nodes;
  const shown = new Set<string>();
  // Folders the user added explicitly (from the picker / quick add): drawn even with nothing inside.
  const explicitFolders = new Set<string>();
  for (const id of visible) {
    if (isFolder(id)) {
      explicitFolders.add(id.slice(FOLDER_PREFIX.length));
      continue;
    }
    const n = nodes[id];
    if (!n || isFiltered(n, opts.filter)) continue;
    shown.add(id);
  }

  const parentOf = new Map<string, string | null>();
  for (const id of shown) {
    const n = nodes[id]!;
    parentOf.set(id, n.moduleId && shown.has(n.moduleId) ? n.moduleId : null);
  }

  const elements: DrawnElement[] = [];
  if (opts.folders) {
    const { frames, nearest } = foldersFor(snapshot, shown, explicitFolders);
    for (const f of frames) {
      elements.push(f.element);
      for (const file of f.files) parentOf.set(file, f.element.id);
    }
    // A declaration whose file isn't drawn sits in the nearest drawn folder, if any.
    for (const id of shown) {
      const n = nodes[id]!;
      if (n.kind === "module" || n.kind === "external" || parentOf.get(id)) continue;
      const slash = n.filePath.lastIndexOf("/");
      if (slash > 0) parentOf.set(id, nearest(n.filePath.slice(0, slash)));
    }
  }
  else {
    // Without folder frames, an added folder is a card of its own.
    for (const dir of explicitFolders) elements.push({ id: FOLDER_PREFIX + dir, kind: "folder", name: dir, parent: null });
  }
  for (const id of shown) {
    const n = nodes[id]!;
    elements.push({ id, kind: n.kind, name: n.name, parent: parentOf.get(id) ?? null });
  }

  // Whether one is drawn inside the other: an edge would only run to its own border.
  const containerOf = new Map(elements.map((e) => [e.id, e.parent]));
  const inside = (id: string, around: string) => {
    for (let at = containerOf.get(id) ?? null; at !== null; at = containerOf.get(at) ?? null) if (at === around) return true;
    return false;
  };

  const relations: DrawnRelation[] = [];
  const seen = new Set<string>();
  // With an index, only the edges of drawn nodes are looked at (not the whole snapshot).
  const candidates = index ? [...shown].flatMap((id) => index.out.get(id) ?? []) : snapshot.edges;
  for (const e of candidates) {
    if (e.kind === "declares" || !shown.has(e.from) || !shown.has(e.to) || !opts.enabled[EDGE_GROUP_OF[e.kind]]) continue;
    if (e.from === e.to || inside(e.from, e.to) || inside(e.to, e.from)) continue;
    const id = `${e.kind}:${e.from}->${e.to}:${e.importType ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    relations.push({ id, source: e.from, target: e.to, edge: e });
  }
  return { elements, relations };
}

/**
 * Folder frames around the drawn files. A chain of folders that only holds one
 * folder is drawn as one frame named by the whole chain (`src/components`).
 * The frame's id is its deepest path, so it keeps its place when the chain splits.
 */
function foldersFor(snapshot: Snapshot, shown: Set<string>, explicit: ReadonlySet<string> = new Set()) {
  const fileDirs = new Map<string, string[]>(); // dir → module ids
  for (const id of shown) {
    const n = snapshot.nodes[id]!;
    if (n.kind !== "module") continue;
    const slash = n.filePath.lastIndexOf("/");
    if (slash <= 0 || n.filePath.startsWith("..")) continue;
    const dir = n.filePath.slice(0, slash);
    fileDirs.set(dir, [...(fileDirs.get(dir) ?? []), id]);
  }
  // Every ancestor directory of a drawn file, with its child directories.
  const childDirs = new Map<string, Set<string>>();
  const all = new Set<string>();
  for (const dir of [...fileDirs.keys(), ...explicit]) {
    let cur = dir;
    while (cur) {
      all.add(cur);
      const up = cur.includes("/") ? cur.slice(0, cur.lastIndexOf("/")) : "";
      if (!childDirs.has(up)) childDirs.set(up, new Set());
      childDirs.get(up)!.add(cur);
      cur = up;
    }
  }
  // A directory is drawn unless it holds exactly one directory and no files (and wasn't added explicitly).
  const collapsed = (dir: string) => !fileDirs.has(dir) && !explicit.has(dir) && (childDirs.get(dir)?.size ?? 0) === 1;
  const drawnAncestor = (dir: string): string | null => {
    let up = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
    while (up && collapsed(up)) up = up.includes("/") ? up.slice(0, up.lastIndexOf("/")) : "";
    return up || null;
  };

  const frames: { element: DrawnElement; files: string[] }[] = [];
  const drawnDirs = new Set<string>();
  for (const dir of [...all].sort()) {
    if (collapsed(dir)) continue;
    const parent = drawnAncestor(dir);
    drawnDirs.add(dir);
    frames.push({
      element: {
        id: FOLDER_PREFIX + dir,
        kind: "folder",
        name: parent ? dir.slice(parent.length + 1) : dir,
        parent: parent ? FOLDER_PREFIX + parent : null,
      },
      files: fileDirs.get(dir) ?? [],
    });
  }
  /** The nearest drawn folder frame at or above `dir`. */
  const nearest = (dir: string): string | null => {
    for (let cur = dir; cur; cur = cur.includes("/") ? cur.slice(0, cur.lastIndexOf("/")) : "") {
      if (drawnDirs.has(cur)) return FOLDER_PREFIX + cur;
    }
    return null;
  };
  return { frames, nearest };
}

/** Ids drawn inside a container, all the way down. */
export function descendantsIn(graph: DrawnGraph, id: string): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    for (const e of graph.elements) {
      if (e.parent !== p) continue;
      out.push(e.id);
      walk(e.id);
    }
  };
  walk(id);
  return out;
}

/** Nodes in the folder subtree (for hiding a folder). */
export function nodesUnderFolder(snapshot: Snapshot, visible: readonly string[], folderId: string): string[] {
  const dir = folderId.slice(FOLDER_PREFIX.length) + "/";
  return visible.filter((id) => snapshot.nodes[id]?.filePath.startsWith(dir));
}

export type { GraphNode };
