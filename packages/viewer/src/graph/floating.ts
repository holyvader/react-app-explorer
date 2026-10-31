import { type InternalNode, Position } from "@xyflow/react";

/*
 * Floating edges (after https://reactflow.dev/examples/edges/floating-edges): an edge leaves and
 * enters a node where the line between the two node centres crosses each node's border, instead
 * of fixed handles. Works for nested nodes since it uses absolute positions.
 */

const sizeOf = (n: InternalNode) => ({ w: n.measured.width ?? n.width ?? 0, h: n.measured.height ?? n.height ?? 0 });

/** Where the line from `node`'s centre towards `other`'s centre crosses `node`'s border. */
function intersection(node: InternalNode, other: InternalNode) {
  const { w, h } = sizeOf(node);
  const p = node.internals.positionAbsolute;
  const o = other.internals.positionAbsolute;
  const os = sizeOf(other);
  const w2 = w / 2;
  const h2 = h / 2;
  const x2 = p.x + w2;
  const y2 = p.y + h2;
  const x1 = o.x + os.w / 2;
  const y1 = o.y + os.h / 2;
  const xx1 = (x1 - x2) / (2 * w2) - (y1 - y2) / (2 * h2);
  const yy1 = (x1 - x2) / (2 * w2) + (y1 - y2) / (2 * h2);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = a * xx1;
  const yy3 = a * yy1;
  return { x: w2 * (xx3 + yy3) + x2, y: h2 * (-xx3 + yy3) + y2 };
}

/** Which side of the node a border point is on (for the bezier's curvature). */
function sideOf(node: InternalNode, point: { x: number; y: number }): Position {
  const { x, y } = node.internals.positionAbsolute;
  const { w, h } = sizeOf(node);
  const px = Math.round(point.x);
  const py = Math.round(point.y);
  if (px <= Math.round(x) + 1) return Position.Left;
  if (px >= Math.round(x + w) - 1) return Position.Right;
  if (py <= Math.round(y) + 1) return Position.Top;
  if (py >= Math.round(y + h) - 1) return Position.Bottom;
  return Position.Top;
}

export function floatingEdgeParams(source: InternalNode, target: InternalNode) {
  const s = intersection(source, target);
  const t = intersection(target, source);
  return { sx: s.x, sy: s.y, tx: t.x, ty: t.y, sourcePos: sideOf(source, s), targetPos: sideOf(target, t) };
}
