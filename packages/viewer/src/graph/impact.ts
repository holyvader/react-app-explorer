import type { Edge, GraphNode, NodeId, Snapshot } from "@rae/schema";
import type { GraphIndex } from "./relations.ts";

/*
 * What a diff's changes reach: the routes whose code runs a changed element, and the top-level
 * elements (nothing affected uses them) that do. Pure; read from the head's graph with the removed
 * nodes and edges added back (lib/diff.ts applyDiff).
 *
 * An element is affected when it uses an affected one: renders it, calls it, uses it as a hook, a
 * server action or a type, or declares it (a file holding a changed declaration). A plain import
 * counts only into a file with no declarations of its own (an asset, a module run for its side
 * effects): an import of a file whose one helper changed doesn't mean the importer runs it.
 */

/** Relations along which a change reaches whoever uses the element. */
const USES = new Set<Edge["kind"]>(["renders", "invokes", "usesHook", "invokesAction", "usesType", "declares"]);
/** Route files whose change reaches the nested routes too: they wrap them. */
const WRAPPING = ["layout", "template"];

/** A way from an affected element down to a change: the element first, the changed one last. */
export type Chain = NodeId[];

export interface AffectedRoute {
  id: NodeId;
  url: string;
  kind: "page" | "api" | "segment";
  /** Why: `page`, `layout`, `route`… (its own files), `layout of /blog` (a parent's), `middleware`. */
  via: string[];
  /** From one of its files down to a change. */
  chain: Chain;
  /** How many changed elements its own files reach. */
  changes: number;
}

export interface TopLevel {
  id: NodeId;
  chain: Chain;
  changes: number;
}

export interface Impact {
  /** Changed, added and removed elements (no libraries or routes). */
  changed: NodeId[];
  /** Changed files. */
  files: number;
  /** Whether the project has routes at all (App Router). */
  hasRoutes: boolean;
  /** Page and API routes the change reaches, by URL. */
  routes: AffectedRoute[];
  /** Affected elements nothing affected uses, other than through the routes above. */
  topLevel: TopLevel[];
}

export function impactOf(s: Snapshot, index: GraphIndex): Impact {
  const d = s.diff;
  const empty: Impact = { changed: [], files: 0, hasRoutes: false, routes: [], topLevel: [] };
  if (!d) return empty;
  const node = (id: NodeId): GraphNode | undefined => s.nodes[id];
  const holdsDeclarations = (id: NodeId) => (index.out.get(id) ?? []).some((e) => e.kind === "declares");
  /** Whether a change at `to` reaches `from` along this edge. */
  const carries = (e: Edge) => USES.has(e.kind) || (e.kind === "imports" && node(e.to)?.kind === "module" && !holdsDeclarations(e.to));

  const changed = Object.keys(d.nodes).filter((id) => {
    const n = node(id);
    return n && n.kind !== "external" && n.kind !== "route";
  });
  const isChanged = new Set(changed);

  // Back from every change to whoever uses it, breadth first: `toward` is the next step down to the nearest change.
  const toward = new Map<NodeId, NodeId | null>(changed.map((id) => [id, null]));
  const queue = [...changed];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i]!;
    for (const e of index.in.get(at) ?? []) {
      if (!carries(e) || toward.has(e.from) || !node(e.from)) continue;
      toward.set(e.from, at);
      queue.push(e.from);
    }
  }
  const affected = (id: NodeId | undefined) => !!id && toward.has(id);
  const chainOf = (id: NodeId): Chain => {
    const chain = [id];
    for (let at = toward.get(id); at; at = toward.get(at)) chain.push(at);
    return chain;
  };
  /** Changed elements reachable from these, down the same relations. */
  const changesFrom = (starts: NodeId[]) => {
    const seen = new Set<NodeId>();
    const todo = starts.filter(affected);
    let count = 0;
    while (todo.length) {
      const at = todo.pop()!;
      if (seen.has(at)) continue;
      seen.add(at);
      if (isChanged.has(at)) count++;
      for (const e of index.out.get(at) ?? []) if (carries(e) && affected(e.to) && !seen.has(e.to)) todo.push(e.to);
    }
    return { count, seen };
  };

  // Routes: their own files, a wrapping parent's layout or template, their middleware.
  const routeNodes = Object.values(s.nodes).filter((n) => n.kind === "route" && n.route);
  const middlewareOf = new Map<NodeId, NodeId[]>();
  for (const e of s.edges) if (e.kind === "runsBefore") middlewareOf.set(e.to, [...(middlewareOf.get(e.to) ?? []), e.from]);
  const covered = new Set<NodeId>();
  const routes: AffectedRoute[] = [];
  for (const r of routeNodes) {
    const info = r.route!;
    if (info.kind === "segment") continue;
    const via: string[] = [];
    const starts: NodeId[] = [];
    for (const [role, file] of Object.entries(info.files)) {
      if (!affected(file)) continue;
      via.push(role);
      starts.push(file!);
    }
    for (let p = info.parent; p; p = node(p)?.route?.parent) {
      const parent = node(p)?.route;
      if (!parent) break;
      for (const role of WRAPPING) {
        const file = parent.files[role];
        if (!affected(file)) continue;
        via.push(`${role} of ${parent.url}`);
        starts.push(file!);
      }
    }
    for (const m of middlewareOf.get(r.id) ?? []) {
      if (!affected(m)) continue;
      via.push("middleware");
      starts.push(m);
    }
    if (!starts.length) continue;
    const reach = changesFrom(starts);
    for (const id of reach.seen) covered.add(id);
    routes.push({ id: r.id, url: info.url, kind: info.kind, via, chain: chainOf(starts[0]!), changes: reach.count });
  }
  routes.sort((a, b) => a.url.localeCompare(b.url) || a.kind.localeCompare(b.kind));

  // Top level: affected, used by nothing affected, and not already behind a route. A file that only
  // holds a change others use (a shared helper's file) isn't: it surfaces where they are.
  const usedByAffected = (id: NodeId, besides?: NodeId) => (index.in.get(id) ?? []).some((e) => carries(e) && affected(e.from) && e.from !== besides);
  const onlyHolds = (id: NodeId) => {
    const held = (index.out.get(id) ?? []).filter((e) => e.kind === "declares" && affected(e.to)).map((e) => e.to);
    return held.length > 0 && held.every((d) => usedByAffected(d, id));
  };
  const topLevel: TopLevel[] = [];
  for (const id of toward.keys()) {
    const n = node(id);
    if (!n || n.kind === "route" || n.kind === "external" || covered.has(id) || usedByAffected(id) || onlyHolds(id)) continue;
    topLevel.push({ id, chain: chainOf(id), changes: changesFrom([id]).count });
  }
  topLevel.sort((a, b) => b.changes - a.changes || (node(a.id)?.filePath ?? a.id).localeCompare(node(b.id)?.filePath ?? b.id));

  return { changed, files: d.files.length, hasRoutes: routeNodes.length > 0, routes, topLevel };
}
