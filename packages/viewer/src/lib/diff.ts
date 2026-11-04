import type { ChangeKind, Edge, GraphNode, Snapshot } from "@rae/schema";

/*
 * A diff snapshot (`snapshot.diff`, see @rae/scanner's diffScan) is the head's graph plus what
 * changed against the base. On load, what only the base had (removed nodes and edges) is put into
 * the graph as ghosts, so everything (tree, canvas, details, relations) can show it; the diff
 * overlay hides them again when it's off.
 */

const ghostNodes = new WeakSet<GraphNode>();
const edgeChanges = new WeakMap<Edge, "added" | "removed">();

const edgeKey = (e: Edge) => `${e.kind}|${e.from}|${e.to}|${e.importType ?? ""}`;

/** Puts a diff's removed nodes and edges into the snapshot (as ghosts) and marks added edges. Idempotent. */
export function applyDiff(s: Snapshot): Snapshot {
  const d = s.diff;
  if (!d) return s;
  for (const [id, n] of Object.entries(d.removed)) {
    if (s.nodes[id]) continue; // a head node took its id (a new file where a renamed one was)
    s.nodes[id] = n;
    ghostNodes.add(n);
  }
  const added = new Set(d.edges.added.map(edgeKey));
  for (const e of s.edges) if (added.has(edgeKey(e))) edgeChanges.set(e, "added");
  const known = new Set(s.edges.map(edgeKey));
  for (const e of d.edges.removed) {
    if (known.has(edgeKey(e)) || !s.nodes[e.from] || !s.nodes[e.to]) continue;
    s.edges.push(e);
    edgeChanges.set(e, "removed");
  }
  return s;
}

/** A node only the base had: drawn as a ghost (dashed, faded) while the diff overlay is on. */
export const isGhost = (n: GraphNode | undefined) => !!n && ghostNodes.has(n);
/** Whether a relation is new in the head, or gone from it. */
export const edgeChange = (e: Edge): "added" | "removed" | undefined => edgeChanges.get(e);
/** How a node changed in the snapshot's diff. */
export const changeOf = (s: Snapshot | undefined, id: string): ChangeKind | undefined => s?.diff?.nodes[id];

export const CHANGE_LETTER: Record<ChangeKind, string> = { added: "A", changed: "M", removed: "D" };
export const CHANGE_WORD: Record<ChangeKind, string> = { added: "added", changed: "changed", removed: "removed" };

/** Most changes put on the canvas when a diff opens (declarations first, then files). */
export const CHANGES_ON_OPEN = 60;

/**
 * What a diff opens with: its changed, added and removed elements — declarations, and the files
 * holding them (as frames, for context) — without libraries and routes. Declarations come first.
 */
export function changesToShow(s: Snapshot, limit = CHANGES_ON_OPEN): string[] {
  const d = s.diff;
  if (!d) return [];
  const decls: string[] = [];
  const files: string[] = [];
  for (const id of Object.keys(d.nodes)) {
    const n = s.nodes[id];
    if (!n || n.kind === "external" || n.kind === "route" || n.asset) continue;
    (n.kind === "module" ? files : decls).push(id);
  }
  const picked = decls.slice(0, limit);
  // the files around the picked declarations, then other changed files, while there's room
  const around = new Set(picked.map((id) => s.nodes[id]?.moduleId).filter((m): m is string => !!m && !!s.nodes[m]));
  const rest = files.filter((f) => !around.has(f));
  return [...picked, ...[...around, ...rest].slice(0, Math.max(0, limit - picked.length))];
}

/** A side of the diff in short: `main 1a2b3c4`, a request ref as `#12`. */
export function sideLabel(ref: string, sha: string): string {
  if (sha.startsWith(ref)) return sha.slice(0, 7);
  const m = ref.match(/^refs\/(pull|merge-requests)\/(\d+)\/head$/);
  const name = m ? `${m[1] === "pull" ? "#" : "!"}${m[2]}` : ref;
  return `${name} ${sha.slice(0, 7)}`;
}

/**
 * What changed in a node, in words: props / params added or removed, the return type, the boundary,
 * the Next.js role, the route's rendering, the type's text. Empty when only the body changed.
 */
export function describeChange(before: GraphNode, after: GraphNode): { what: string; from?: string; to?: string }[] {
  const out: { what: string; from?: string; to?: string }[] = [];
  const names = (n: GraphNode) => (n.props ?? n.signature?.params ?? []).map((p) => p.name);
  const was = new Set(names(before));
  const now = new Set(names(after));
  const isProps = !!(after.props ?? before.props);
  for (const p of now) if (!was.has(p)) out.push({ what: `${isProps ? "prop" : "parameter"} added`, to: p });
  for (const p of was) if (!now.has(p)) out.push({ what: `${isProps ? "prop" : "parameter"} removed`, from: p });
  const typeOf = (n: GraphNode, name: string) => (n.props ?? n.signature?.params ?? []).find((p) => p.name === name)?.type;
  for (const p of now) if (was.has(p) && typeOf(before, p) !== typeOf(after, p)) out.push({ what: `${p}: type`, from: typeOf(before, p), to: typeOf(after, p) });
  const ret = (n: GraphNode) => n.signature?.returnType;
  if (ret(before) !== ret(after)) out.push({ what: "return type", from: ret(before), to: ret(after) });
  if (before.isAsync !== after.isAsync) out.push({ what: "async", from: before.isAsync ? "yes" : "no", to: after.isAsync ? "yes" : "no" });
  if (before.kind !== after.kind) out.push({ what: "kind", from: before.kind, to: after.kind });
  if (before.moduleType !== after.moduleType) out.push({ what: "boundary", from: before.moduleType, to: after.moduleType });
  if (before.nextRole !== after.nextRole) out.push({ what: "Next.js role", from: before.nextRole, to: after.nextRole });
  if (before.exported !== after.exported) out.push({ what: "exported", from: before.exported ? "yes" : "no", to: after.exported ? "yes" : "no" });
  const mode = (n: GraphNode) => n.route?.rendering?.mode;
  if (mode(before) !== mode(after)) out.push({ what: "rendering", from: mode(before), to: mode(after) });
  if (before.typeText !== after.typeText && (before.typeText || after.typeText)) out.push({ what: "type", from: before.typeText, to: after.typeText });
  const lines = (n: GraphNode) => (n.loc && n.endLine ? n.endLine - n.loc.line + 1 : undefined);
  if (lines(before) !== lines(after) && lines(before) && lines(after)) out.push({ what: "lines", from: String(lines(before)), to: String(lines(after)) });
  return out;
}
