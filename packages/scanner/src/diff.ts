import type { ChangeKind, Edge, GraphNode, NodeId, Snapshot, SnapshotDiff } from "@rae/schema";

type Files = SnapshotDiff["files"];

/**
 * What changed from `base` to `head` (both scanned the same way). Ids are path-based, so most nodes
 * match by id; files git saw renamed map their nodes (`old.tsx#X` → `new.tsx#X`) first.
 * - added / removed: the node is only in the head / only in the base.
 * - changed: its source differs (the `hash` of the declaration or file), or what it is does
 *   (server ↔ client, Next.js role, a route's kind, methods or rendering). Assets (no hash):
 *   when git lists their file as modified or renamed.
 * Edges are compared by kind and ends (and import type); conditions aren't compared.
 */
export function diffSnapshots(base: Snapshot, head: Snapshot, files: Files, sides: Pick<SnapshotDiff, "base" | "head" | "against" | "compared">): SnapshotDiff {
  const renamed: Record<NodeId, NodeId> = {};
  const fileRenames = new Map(files.filter((f) => f.status === "renamed" && f.from).map((f) => [f.from!, f.path]));
  const toHead = (id: NodeId): NodeId => {
    if (!fileRenames.size) return id;
    const hash = id.indexOf("#");
    const file = hash < 0 ? id : id.slice(0, hash);
    const to = fileRenames.get(file);
    return to ? to + (hash < 0 ? "" : id.slice(hash)) : id;
  };
  for (const id of Object.keys(base.nodes)) {
    const to = toHead(id);
    if (to !== id) renamed[id] = to;
  }

  const nodes: Record<NodeId, ChangeKind> = {};
  const removed: Record<NodeId, GraphNode> = {};
  const before: Record<NodeId, GraphNode> = {};
  const inBase = new Map<NodeId, GraphNode>();
  for (const [id, n] of Object.entries(base.nodes)) inBase.set(renamed[id] ?? id, n);
  // assets (CSS, images…) aren't parsed, so they have no source hash: git says whether they changed
  const touched = new Set(files.filter((f) => f.status === "modified" || f.status === "renamed").map((f) => f.path));
  for (const [id, n] of Object.entries(head.nodes)) {
    const was = inBase.get(id);
    if (!was) nodes[id] = "added";
    else if (fingerprint(was) !== fingerprint(n) || (n.asset && touched.has(n.filePath))) {
      nodes[id] = "changed";
      const { renderTree: _tree, ...rest } = was;
      before[id] = rest;
    }
  }
  for (const [id, n] of Object.entries(base.nodes)) if (!head.nodes[renamed[id] ?? id]) removed[id] = n;
  for (const id of Object.keys(removed)) nodes[id] = "removed";

  const key = (e: Edge) => `${e.kind}|${e.from}|${e.to}|${e.importType ?? ""}`;
  const baseEdges = new Map<string, Edge>();
  for (const e of base.edges) {
    const moved = renamed[e.from] || renamed[e.to] ? { ...e, from: renamed[e.from] ?? e.from, to: renamed[e.to] ?? e.to } : e;
    baseEdges.set(key(moved), moved);
  }
  const headKeys = new Set(head.edges.map(key));
  const added = head.edges.filter((e) => !baseEdges.has(key(e)));
  const gone = [...baseEdges].filter(([k]) => !headKeys.has(k)).map(([, e]) => e);

  return { ...sides, annotations: true, nodes, removed, before, renamed, edges: { added, removed: gone }, files };
}

/** What a node's change is judged by: its source, and what it is. */
function fingerprint(n: GraphNode): string {
  if (n.kind === "external") return "";
  if (n.kind === "route" && n.route) {
    const r = n.route;
    return JSON.stringify([r.url, r.kind, r.methods, r.rendering?.mode, r.rendering?.revalidate, r.rendering?.blocking, r.middleware?.id]);
  }
  // old snapshots without hashes: what's recorded about the declaration
  const source = n.hash ?? JSON.stringify([n.props, n.signature, n.typeText, n.renderTree?.length, n.hooksUsed?.length]);
  return JSON.stringify([n.kind, source, n.moduleType, n.nextRole, n.exported, n.missing]);
}
