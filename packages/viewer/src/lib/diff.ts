import type { ChangeKind, Edge, GraphNode, Snapshot } from "@rae/schema";
import { typeLines } from "./syntax.ts";

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

/** A side of the diff in short: `main 1a2b3c4`, a request ref as `#12`, the working tree as `main + uncommitted`. */
export function sideLabel(ref: string, sha: string, worktree?: boolean): string {
  if (worktree) return `${ref.startsWith(sha.slice(0, 4)) ? sha.slice(0, 7) : ref} + uncommitted`;
  if (sha.startsWith(ref)) return sha.slice(0, 7);
  const m = ref.match(/^refs\/(pull|merge-requests)\/(\d+)\/head$/);
  const name = m ? `${m[1] === "pull" ? "#" : "!"}${m[2]}` : ref;
  return `${name} ${sha.slice(0, 7)}`;
}

/** A prop or parameter on one side of a change: its name, type and whether it's optional. */
export interface ParamSide {
  name: string;
  type?: string;
  optional?: boolean;
  /** The annotation as written (diff snapshots that record them). */
  written?: string;
}

/** A change to an element's signature: a prop / parameter added, removed or retyped, or its return type. */
export type SignatureChange =
  | { kind: "param"; what: "added" | "removed" | "changed"; isProp: boolean; from?: ParamSide; to?: ParamSide }
  | { kind: "return"; from: string; to: string }
  /** The same return type, but the code it returns changed (`return` statements, an arrow's body). */
  | { kind: "returned"; type: string };

/**
 * What changed in an element's signature — props or parameters (added, removed, a different type or
 * optionality) and its return type — for the details' "In this diff". The rest (body, boundary,
 * role…) is the code diff's to show. Types are compared as displayed: whitespace, and the
 * `| undefined` TypeScript adds to optional ones, don't count; and only when both sides have a type
 * (the base is compared without the type pass, so a type on the head alone isn't a change).
 */
export function signatureChanges(before: GraphNode, after: GraphNode, { annotations = false }: { annotations?: boolean } = {}): SignatureChange[] {
  const isProp = !!(after.props ?? before.props);
  const list = (n: GraphNode): ParamSide[] =>
    (n.props ?? n.signature?.params ?? []).map((p) => ({ name: p.name, type: p.type, optional: !!p.optional, ...(p.written !== undefined ? { written: p.written } : {}) }));
  const was = new Map(list(before).map((p) => [p.name, p]));
  const now = new Map(list(after).map((p) => [p.name, p]));
  const shown = (t: string | undefined, optional?: boolean) => (t === undefined ? undefined : typeLines(t, { flat: true, optional }).join(""));
  const differs = (a?: string, b?: string, optional?: boolean) => a !== undefined && b !== undefined && shown(a, optional) !== shown(b, optional);
  // With annotations (`written`), what the code says is compared — the same as the code diff: the
  // checker may print an unchanged annotation differently (an import changed, an alias expanded).
  // Annotated on one side only: a change; on neither: the inferred types (both sides are typed).
  const typeDiffers = (a: ParamSide, b: ParamSide, optional?: boolean) => {
    if (!annotations) return differs(a.type, b.type, optional);
    if (a.written !== undefined || b.written !== undefined) return a.written === undefined || b.written === undefined || differs(a.written, b.written, optional);
    return differs(a.type, b.type, optional);
  };
  // shown as written when known (else as the checker printed it)
  const asShown = (p: ParamSide): ParamSide => (annotations && p.written !== undefined ? { ...p, type: p.written } : p);
  const out: SignatureChange[] = [];
  for (const [name, to] of now) {
    const from = was.get(name);
    if (!from) out.push({ kind: "param", what: "added", isProp, to: asShown(to) });
    else if (from.optional !== to.optional || typeDiffers(from, to, from.optional && to.optional)) out.push({ kind: "param", what: "changed", isProp, from: asShown(from), to: asShown(to) });
  }
  for (const [name, from] of was) if (!now.has(name)) out.push({ kind: "param", what: "removed", isProp, from: asShown(from) });
  if (annotations) {
    const a = before.signature?.returnWritten;
    const b = after.signature?.returnWritten;
    const ra = before.signature?.returnType;
    const rb = after.signature?.returnType;
    if (a !== undefined || b !== undefined) {
      // annotated (on a side at least): as written; a side without one shows what was inferred
      if (a === undefined || b === undefined || differs(a, b)) out.push({ kind: "return", from: a ?? ra ?? "(inferred)", to: b ?? rb ?? "(inferred)" });
    } else if (differs(ra, rb)) out.push({ kind: "return", from: ra!, to: rb! });
  } else {
    const ret = (n: GraphNode) => n.signature?.returnType;
    if (differs(ret(before), ret(after))) out.push({ kind: "return", from: ret(before)!, to: ret(after)! });
  }
  // the type stayed, what's returned didn't
  const ha = before.signature?.returnHash;
  const hb = after.signature?.returnHash;
  if (!out.some((c) => c.kind === "return") && ha && hb && ha !== hb) {
    const type = after.signature?.returnWritten ?? after.signature?.returnType ?? before.signature?.returnWritten ?? before.signature?.returnType;
    out.push({ kind: "returned", type: type ?? "(inferred)" });
  }
  return out;
}
