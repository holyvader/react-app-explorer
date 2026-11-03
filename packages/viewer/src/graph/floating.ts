import { type InternalNode, Position } from "@xyflow/react";

/*
 * Floating edges (after https://reactflow.dev/examples/edges/floating-edges): an edge leaves and
 * enters a node where the line between the two node centres crosses each node's border, instead
 * of fixed handles. Works for nested nodes since it uses absolute positions.
 */

const sizeOf = (n: InternalNode) => ({ w: n.measured.width ?? n.width ?? 0, h: n.measured.height ?? n.height ?? 0 });

/**
 * Where the line from `node`'s centre (moved by `shift`) towards `other`'s centre (moved the same)
 * crosses `node`'s border.
 */
function intersection(node: InternalNode, other: InternalNode, shift = { x: 0, y: 0 }) {
  const { w, h } = sizeOf(node);
  const p = node.internals.positionAbsolute;
  const o = other.internals.positionAbsolute;
  const os = sizeOf(other);
  const w2 = w / 2;
  const h2 = h / 2;
  // the shifted centre stays inside the node (a lane can't leave a small card)
  const sx = Math.max(-w2 * 0.8, Math.min(w2 * 0.8, shift.x));
  const sy = Math.max(-h2 * 0.8, Math.min(h2 * 0.8, shift.y));
  const x2 = p.x + w2 + sx;
  const y2 = p.y + h2 + sy;
  const x1 = o.x + os.w / 2 + sx;
  const y1 = o.y + os.h / 2 + sy;
  // from the shifted centre towards the other node: the first border crossing
  const dx = x1 - x2;
  const dy = y1 - y2;
  if (!dx && !dy) return { x: x2, y: y2 };
  const left = p.x;
  const right = p.x + w;
  const top = p.y;
  const bottom = p.y + h;
  const ts = [
    dx > 0 ? (right - x2) / dx : dx < 0 ? (left - x2) / dx : Infinity,
    dy > 0 ? (bottom - y2) / dy : dy < 0 ? (top - y2) / dy : Infinity,
  ];
  const t = Math.min(...ts);
  return { x: x2 + dx * t, y: y2 + dy * t };
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

/**
 * `lane`: for several relations between the same two nodes, how far (px) this one runs beside the
 * line between their centres, so they don't draw on top of each other. Positive is to the left of
 * the direction from the lower id to the higher one, so both directions share one set of lanes.
 */
export function floatingEdgeParams(source: InternalNode, target: InternalNode, lane = 0) {
  let shift = { x: 0, y: 0 };
  if (lane) {
    const a = centreOf(source.id < target.id ? source : target);
    const b = centreOf(source.id < target.id ? target : source);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    shift = { x: (-(b.y - a.y) / len) * lane, y: ((b.x - a.x) / len) * lane };
  }
  const s = intersection(source, target, shift);
  const t = intersection(target, source, shift);
  return { sx: s.x, sy: s.y, tx: t.x, ty: t.y, sourcePos: sideOf(source, s), targetPos: sideOf(target, t) };
}

const centreOf = (n: InternalNode) => {
  const { w, h } = sizeOf(n);
  return { x: n.internals.positionAbsolute.x + w / 2, y: n.internals.positionAbsolute.y + h / 2 };
};
