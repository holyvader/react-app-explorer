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
  /** Chips on a card beside its name (a declaration standing for its file: `page`, `server`): the card widens for them. */
  badges?: string[];
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

/** Whether a node is a file on the canvas: a module, or a declaration standing for its file (merged scan). */
export const isFileNode = (n: GraphNode) => n.kind === "module" || !!n.file;
/** The file a node is (or is declared in). */
export const fileIdOf = (n: GraphNode): string | undefined => (isFileNode(n) ? n.id : n.moduleId);

export interface DrawOptions {
  enabled: EnabledGroups;
  filter: LibraryFilter;
  /** Draw folders as frames around file modules. */
  folders: boolean;
  /** Next.js: draw routes as frames around their files (page, layout…), nested by the route tree. */
  routes?: boolean;
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
  // Routes first: the files (and declarations) they hold leave the folder frames.
  const inRoute = new Set<string>();
  if (opts.routes) {
    for (const r of routesFor(snapshot, shown)) {
      if (!shown.has(r.id)) elements.push({ id: r.id, kind: "route", name: nodes[r.id]!.name, parent: r.parent });
      else parentOf.set(r.id, r.parent);
      for (const held of r.holds) {
        parentOf.set(held, r.id);
        inRoute.add(held);
      }
    }
  }
  else {
    // Routes nest like files hold declarations: only what's drawn. A drawn route sits in its nearest
    // drawn parent route; a drawn route file (or a declaration whose file isn't drawn) in its route.
    for (const r of drawnRouteNesting(snapshot, shown)) {
      parentOf.set(r.id, r.parent);
      inRoute.add(r.id);
    }
  }
  if (opts.folders) {
    const { frames, nearest } = foldersFor(snapshot, new Set([...shown].filter((id) => !inRoute.has(id) && nodes[id]!.kind !== "route")), explicitFolders);
    for (const f of frames) {
      elements.push(f.element);
      for (const file of f.files) parentOf.set(file, f.element.id);
    }
    // A declaration whose file isn't drawn sits in the nearest drawn folder, if any.
    for (const id of shown) {
      const n = nodes[id]!;
      if (isFileNode(n) || n.kind === "external" || n.kind === "route" || parentOf.get(id)) continue;
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
    const badges: string[] = n.file ? [n.nextRole, n.moduleType].filter((b) => b !== undefined) : [];
    elements.push({ id, kind: n.kind, name: n.name, parent: parentOf.get(id) ?? null, ...(badges.length ? { badges } : {}) });
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

/** Which route each route file belongs to (module id → route id), per snapshot. */
const routeFileIndex = new WeakMap<Snapshot, Map<string, string>>();
export function routeOfFile(s: Snapshot, moduleId: string): string | undefined {
  let m = routeFileIndex.get(s);
  if (!m) {
    m = new Map();
    for (const n of Object.values(s.nodes)) for (const f of Object.values(n.route?.files ?? {})) if (f) m.set(f, n.id);
    routeFileIndex.set(s, m);
  }
  return m.get(moduleId);
}

/**
 * Route frames: every drawn route file (or a declaration in one, when its file isn't drawn) puts its
 * route — and the routes around it — on the canvas, like folders around files. A route holding
 * nothing drawn but exactly one drawn route is skipped (as folder chains are), unless it was added.
 */
function routesFor(snapshot: Snapshot, shown: Set<string>): { id: string; parent: string | null; holds: string[] }[] {
  const nodes = snapshot.nodes;
  const holds = new Map<string, string[]>();
  for (const id of shown) {
    const n = nodes[id]!;
    if (n.kind === "route") {
      if (!holds.has(id)) holds.set(id, []);
      continue;
    }
    // a file of a route; or a declaration in one whose file isn't drawn
    const file = isFileNode(n) ? id : n.moduleId && !shown.has(n.moduleId) ? n.moduleId : undefined;
    const route = file ? routeOfFile(snapshot, file) : undefined;
    if (route) holds.set(route, [...(holds.get(route) ?? []), id]);
  }
  if (!holds.size) return [];
  // every route above a drawn one, with its drawn child routes
  const parentRoute = (id: string) => nodes[id]?.route?.parent ?? null;
  const children = new Map<string, Set<string>>();
  const all = new Set<string>();
  for (const id of holds.keys()) {
    for (let cur: string | null = id; cur; cur = parentRoute(cur)) {
      all.add(cur);
      const up = parentRoute(cur);
      if (up) (children.get(up) ?? children.set(up, new Set()).get(up)!).add(cur);
    }
  }
  const collapsed = (id: string) => !shown.has(id) && !(holds.get(id)?.length) && (children.get(id)?.size ?? 0) === 1;
  const drawnParent = (id: string): string | null => {
    let up = parentRoute(id);
    while (up && collapsed(up)) up = parentRoute(up);
    return up;
  };
  return [...all].filter((id) => !collapsed(id)).map((id) => ({ id, parent: drawnParent(id), holds: holds.get(id) ?? [] }));
}

/** Where drawn routes and route files sit when routes nest only among what's drawn (no frames added). */
function drawnRouteNesting(snapshot: Snapshot, shown: Set<string>): { id: string; parent: string }[] {
  const nodes = snapshot.nodes;
  const out: { id: string; parent: string }[] = [];
  for (const id of shown) {
    const n = nodes[id]!;
    if (n.kind === "route") {
      let up = n.route?.parent;
      while (up && !shown.has(up)) up = nodes[up]?.route?.parent;
      if (up) out.push({ id, parent: up });
      continue;
    }
    // a route's file; or a declaration in one whose file isn't drawn
    const file = isFileNode(n) ? id : n.moduleId && !shown.has(n.moduleId) ? n.moduleId : undefined;
    const route = file ? routeOfFile(snapshot, file) : undefined;
    if (route && shown.has(route)) out.push({ id, parent: route });
  }
  return out;
}

/** The route an element belongs to: itself (a route), the route of its file, or of its declaration's file. */
export function routeOf(s: Snapshot, id: string): string | undefined {
  const n = s.nodes[id];
  if (!n) return undefined;
  if (n.kind === "route") return id;
  const file = fileIdOf(n);
  return file ? routeOfFile(s, file) : undefined;
}

/** Shared UI along a URL, outermost first: what every route above (and at) it contributes. */
const CHAIN_SHARED = ["layout", "template", "loading", "error", "global-error", "not-found"];

/**
 * Everything that renders a route's URL, root first: each enclosing route (groups included) with its
 * layout, template, loading, error and not-found files, then the route with those and its page (or
 * route.ts for an API). The route nodes themselves too, so the chain shows as nested frames.
 */
export function routeChain(s: Snapshot, routeId: string): string[] {
  const chain: string[] = [];
  for (let cur: string | undefined = routeId; cur; cur = s.nodes[cur]?.route?.parent) chain.unshift(cur);
  // the middleware runs before all of it
  const middleware = s.nodes[routeId]?.route?.middleware?.id;
  const ids: string[] = middleware && s.nodes[middleware] ? [middleware] : [];
  for (const r of chain) {
    const info = s.nodes[r]?.route;
    if (!info) continue;
    ids.push(r);
    for (const role of CHAIN_SHARED) if (info.files[role]) ids.push(info.files[role]!);
    if (r === routeId) for (const role of ["page", "route"]) if (info.files[role]) ids.push(info.files[role]!);
  }
  return [...new Set(ids)];
}

/** Nodes drawn inside a route frame: its files (and their declarations) and its nested routes' — for removing it. */
export function nodesUnderRoute(snapshot: Snapshot, visible: readonly string[], routeId: string): string[] {
  const inside = (r: string | undefined): boolean => {
    for (let cur = r; cur; cur = snapshot.nodes[cur]?.route?.parent) if (cur === routeId) return true;
    return false;
  };
  return visible.filter((id) => {
    const n = snapshot.nodes[id];
    if (!n) return false;
    if (n.kind === "route") return inside(n.route?.parent) || id === routeId;
    const file = fileIdOf(n);
    return !!file && inside(routeOfFile(snapshot, file));
  });
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
    if (!isFileNode(n)) continue;
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
