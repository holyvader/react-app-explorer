import type { GraphNode, Snapshot } from "@rae/schema";
import { useEffect, useState } from "react";
import { fetchSource } from "./api.ts";
import { sideLabel } from "./diff.ts";
import { type DiffLine, diffLines } from "./lineDiff.ts";

/*
 * One element's code diff in a diff snapshot: both versions read from git (the server's
 * `git show`, or the working tree), the element's lines cut out (a declaration's, or the whole
 * file), and the line diff. The details' "In this diff" header (its − / + counts) and the code
 * diff dialog use the same result, loaded once per element and snapshot.
 */

/** One side: which commit (or "worktree"), its label, the node as it is on that side, and whether it's a whole file. */
export interface DiffSide {
  sha: string;
  label: string;
  node: GraphNode;
  whole: boolean;
}

export interface NodeDiff {
  lines: DiffLine[];
  /** Both files' text, for colouring (undefined: that side doesn't exist). */
  before?: string;
  after?: string;
  truncated?: boolean;
  added: number;
  removed: number;
}

/** The two sides of a node's change: the base (changed / removed) and the head (changed / added). */
export function sidesOf(snapshot: Snapshot, node: GraphNode): { before?: DiffSide; after?: DiffSide; whole: boolean } {
  const diff = snapshot.diff!;
  const change = diff.nodes[node.id];
  const whole = node.kind === "module" || !!node.file;
  const was = change === "changed" ? diff.before[node.id] : change === "removed" ? node : undefined;
  return {
    whole,
    before: was ? { sha: diff.compared, label: sideLabel(diff.base.ref, diff.compared), node: was, whole } : undefined,
    after: change === "removed" ? undefined : { sha: diff.head.worktree ? "worktree" : diff.head.sha, label: sideLabel(diff.head.ref, diff.head.sha, diff.head.worktree), node, whole },
  };
}

/** The lines a node covers in its file's text: a declaration's (from its name's line to its last), else the whole file. */
export function linesOf(text: string, side: DiffSide): { lines: string[]; start: number } {
  const all = text.split("\n");
  if (all.length && all[all.length - 1] === "") all.pop();
  const { loc, endLine } = side.node;
  if (side.whole || !loc || !endLine) return { lines: all, start: 1 };
  const from = Math.max(1, loc.line);
  return { lines: all.slice(from - 1, endLine), start: from };
}

/** The diff of two texts as a node covers them (exported for tests). */
export function diffOf(before: { text?: string; side?: DiffSide }, after: { text?: string; side?: DiffSide }): Omit<NodeDiff, "truncated"> {
  const b = before.side && before.text !== undefined ? linesOf(before.text, before.side) : { lines: [], start: 1 };
  const a = after.side && after.text !== undefined ? linesOf(after.text, after.side) : { lines: [], start: 1 };
  const lines = diffLines(b.lines, a.lines, b.start, a.start);
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.type === "add") added++;
    else if (l.type === "del") removed++;
  }
  return { lines, before: before.text, after: after.text, added, removed };
}

const loaded = new WeakMap<Snapshot, Map<string, Promise<NodeDiff>>>();

/** Loads (once per snapshot and node) a node's code diff. A failure isn't kept: the next ask tries again. */
export function loadNodeDiff(snapshot: Snapshot, node: GraphNode): Promise<NodeDiff> {
  let m = loaded.get(snapshot);
  if (!m) loaded.set(snapshot, (m = new Map()));
  const known = m.get(node.id);
  if (known) return known;
  const { before, after } = sidesOf(snapshot, node);
  const read = (side?: DiffSide) => (side ? fetchSource(snapshot.rootDir, side.sha, side.node.filePath) : Promise.resolve(undefined));
  const p = Promise.all([read(before), read(after)]).then(([b, a]) => ({
    ...diffOf({ text: b?.text, side: before }, { text: a?.text, side: after }),
    truncated: b?.truncated || a?.truncated,
  }));
  m.set(node.id, p);
  p.catch(() => m.delete(node.id));
  return p;
}

/** A node's code diff, loaded when `enabled` (an external system: the server reads git). */
export function useNodeDiff(snapshot: Snapshot | undefined, node: GraphNode, enabled = true): { diff?: NodeDiff; error?: string } {
  const key = snapshot?.diff ? `${node.id}|${snapshot.diff.compared}|${snapshot.diff.head.sha}` : "";
  const [state, setState] = useState<{ key: string; diff?: NodeDiff; error?: string }>();
  useEffect(() => {
    if (!enabled || !snapshot?.diff || !key) return;
    let live = true;
    loadNodeDiff(snapshot, node)
      .then((d) => live && setState({ key, diff: d }))
      .catch((e: Error) => live && setState({ key, error: e.message }));
    return () => {
      live = false;
    };
  }, [enabled, snapshot, node, key]);
  return state?.key === key ? state : {};
}
