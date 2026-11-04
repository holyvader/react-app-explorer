import type { Edge, EdgeKind, NodeKind, Snapshot } from "@rae/schema";
import { edgeChange } from "../lib/diff.ts";
import { isFiltered, type LibraryFilter } from "./packages.ts";

/** Edge groups the user can toggle in the toolbar. */
export type EdgeGroup = "imports" | "declares" | "renders" | "hooks" | "invokes" | "types" | "navigation" | "cache";

export const EDGE_GROUP_OF: Record<EdgeKind, EdgeGroup> = {
  imports: "imports",
  declares: "declares",
  renders: "renders",
  usesHook: "hooks",
  invokes: "invokes",
  invokesAction: "invokes",
  usesType: "types",
  // a route's files and nested routes are structure, like what a file declares
  routeFile: "declares",
  routeChild: "declares",
  navigates: "navigation",
  fetches: "navigation",
  revalidates: "navigation",
  runsBefore: "navigation",
  invalidates: "cache",
};

export const EDGE_GROUPS: { group: EdgeGroup; label: string }[] = [
  { group: "imports", label: "Imports" },
  { group: "declares", label: "Declares" },
  { group: "renders", label: "Renders" },
  { group: "hooks", label: "Hooks" },
  { group: "invokes", label: "Invokes" },
  { group: "types", label: "Types" },
  { group: "navigation", label: "Navigation" },
  { group: "cache", label: "Cache" },
];

/** Which outgoing edge kinds count as "children" for each node kind. */
const CHILD_KINDS: Record<NodeKind, ReadonlySet<EdgeKind>> = {
  module: new Set(["imports", "declares", "renders", "invokes", "invokesAction", "runsBefore"]),
  component: new Set(["renders", "usesHook", "invokes", "invokesAction", "usesType", "navigates", "fetches", "revalidates", "invalidates"]),
  hook: new Set(["usesHook", "invokes", "invokesAction", "usesType", "navigates", "fetches", "revalidates", "invalidates"]),
  serverAction: new Set(["invokes", "invokesAction", "usesHook", "usesType", "navigates", "fetches", "revalidates", "invalidates"]),
  function: new Set(["invokes", "usesHook", "invokesAction", "usesType", "navigates", "fetches", "revalidates", "invalidates"]),
  type: new Set(["usesType"]),
  route: new Set(["routeChild", "routeFile"]),
  external: new Set(),
};

export interface GraphIndex {
  out: Map<string, Edge[]>;
  in: Map<string, Edge[]>;
}

export function buildIndex(s: Snapshot): GraphIndex {
  const out = new Map<string, Edge[]>();
  const inc = new Map<string, Edge[]>();
  for (const e of s.edges) {
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
    (inc.get(e.to) ?? inc.set(e.to, []).get(e.to)!).push(e);
  }
  return { out, in: inc };
}

export type EnabledGroups = Record<EdgeGroup, boolean>;

/** Which relations count, and which libraries are filtered out. */
export interface RelationFilter {
  enabled: EnabledGroups;
  libraries: LibraryFilter;
}

const isChildEdge = (s: Snapshot, e: Edge, f: RelationFilter) => {
  const from = s.nodes[e.from];
  return (
    !!from &&
    (CHILD_KINDS[from.kind].has(e.kind) || (!!from.file && CHILD_KINDS.module.has(e.kind))) &&
    f.enabled[EDGE_GROUP_OF[e.kind]] &&
    !(f.libraries.hideRemoved && edgeChange(e) === "removed") &&
    !isFiltered(s.nodes[e.to], f.libraries) &&
    !isFiltered(from, f.libraries)
  );
};

export function childEdges(s: Snapshot, ix: GraphIndex, id: string, f: RelationFilter): Edge[] {
  return (ix.out.get(id) ?? []).filter((e) => isChildEdge(s, e, f));
}

export function parentEdges(s: Snapshot, ix: GraphIndex, id: string, f: RelationFilter): Edge[] {
  return (ix.in.get(id) ?? []).filter((e) => isChildEdge(s, e, f));
}

/**
 * Nodes reachable from `id` in one direction. `deep` walks until roots/leaves (cycle-safe).
 * Returns ids in BFS order, excluding the start node.
 */
export function reachable(
  s: Snapshot,
  ix: GraphIndex,
  id: string,
  dir: "parents" | "children",
  deep: boolean,
  f: RelationFilter,
): string[] {
  const seen = new Set([id]);
  const order: string[] = [];
  let frontier = [id];
  while (frontier.length) {
    const next: string[] = [];
    for (const cur of frontier) {
      const edges = dir === "children" ? childEdges(s, ix, cur, f) : parentEdges(s, ix, cur, f);
      for (const e of edges) {
        const other = dir === "children" ? e.to : e.from;
        if (seen.has(other)) continue;
        seen.add(other);
        order.push(other);
        next.push(other);
      }
    }
    if (!deep) break;
    frontier = next;
  }
  return order;
}

/**
 * Whether expanding from `id` would add anything not drawn yet: directly (`deep` = false) or
 * anywhere up to the roots / down to the leaves. Stops at the first undrawn node, so when
 * everything is drawn it only walks drawn nodes.
 */
export function hasUndrawn(
  s: Snapshot,
  ix: GraphIndex,
  id: string,
  dir: "parents" | "children",
  deep: boolean,
  f: RelationFilter,
  drawn: ReadonlySet<string>,
): boolean {
  const seen = new Set([id]);
  let frontier = [id];
  while (frontier.length) {
    const next: string[] = [];
    for (const cur of frontier) {
      const edges = dir === "children" ? childEdges(s, ix, cur, f) : parentEdges(s, ix, cur, f);
      for (const e of edges) {
        const other = dir === "children" ? e.to : e.from;
        if (seen.has(other)) continue;
        seen.add(other);
        if (!drawn.has(other)) return true;
        next.push(other);
      }
    }
    if (!deep) return false;
    frontier = next;
  }
  return false;
}
