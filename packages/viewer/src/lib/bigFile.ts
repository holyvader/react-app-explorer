import type { GraphNode, NodeKind, Snapshot } from "@rae/schema";
import type { GraphIndex } from "../graph/relations.ts";

/** What counts as a "function" for the big-file limit: everything that runs (not types, not constants). */
const FUNCTION_KINDS = new Set<NodeKind>(["component", "hook", "function", "serverAction"]);

export interface FileSize {
  /** Unknown in snapshots read before line counts were recorded. */
  lines?: number;
  functions: number;
}

/** A file's size: its lines and the components, hooks and functions it declares (a merged file: itself). */
export function fileSize(s: Snapshot, index: GraphIndex, node: GraphNode): FileSize | undefined {
  if (node.kind !== "module" && !node.file) return undefined;
  if (node.asset || node.missing) return undefined;
  const functions = node.file
    ? Number(FUNCTION_KINDS.has(node.kind))
    : (index.out.get(node.id) ?? []).filter((e) => e.kind === "declares" && FUNCTION_KINDS.has(s.nodes[e.to]?.kind as NodeKind)).length;
  return { lines: node.lines, functions };
}

export interface BigFile {
  /** The badge: short, the room on a file's header is tight ("big"); the numbers are in `title`. */
  label: string;
  /** Its tooltip: the numbers against the limits (Settings → Code health). */
  title: string;
}

/** Whether a file is past either limit, and how to say so; undefined when it isn't. */
export function bigFileOf(size: FileSize | undefined, limits: { lines: number; functions: number }): BigFile | undefined {
  if (!size) return undefined;
  const why: string[] = [];
  if (size.lines !== undefined && size.lines > limits.lines) {
    why.push(`${size.lines} lines (more than ${limits.lines})`);
  }
  if (size.functions > limits.functions) {
    why.push(`${size.functions} components, hooks and functions (more than ${limits.functions})`);
  }
  if (!why.length) return undefined;
  return { label: "big", title: `Big file: ${why.join(", ")}. Limits in Settings → Code health.` };
}
