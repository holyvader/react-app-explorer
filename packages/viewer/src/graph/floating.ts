import { type InternalNode, Position } from "@xyflow/react";
import { TAG_DEPTH } from "./layout.ts";

/*
 * Floating edges (after https://reactflow.dev/examples/edges/floating-edges): an edge leaves and
 * enters a node where the line between the two node centres crosses each node's border, instead
 * of fixed handles. Works for nested nodes since it uses absolute positions. Component cards are a
 * tag, `< >`: their border is that outline, so an edge from the side ends at the point.
 */

const sizeOf = (n: InternalNode) => ({ w: n.measured.width ?? n.width ?? 0, h: n.measured.height ?? n.height ?? 0 });

type Point = { x: number; y: number };

/** A component card: drawn as a tag (TagOutline), not a box. */
const isTag = (n: InternalNode) => n.type === "card" && (n.data as { node?: { kind?: string } }).node?.kind === "component";

/** The tag's corners, clockwise from the top left, each with the side its edge to the next one faces. */
function tagCorners(p: Point, w: number, h: number): [Point, Position][] {
  const d = TAG_DEPTH;
  return [
    [{ x: p.x + d, y: p.y }, Position.Top],
    [{ x: p.x + w - d, y: p.y }, Position.Right],
    [{ x: p.x + w, y: p.y + h / 2 }, Position.Right],
    [{ x: p.x + w - d, y: p.y + h }, Position.Bottom],
    [{ x: p.x + d, y: p.y + h }, Position.Left],
    [{ x: p.x, y: p.y + h / 2 }, Position.Left],
  ];
}

/** Where a ray from `o` (inside the tag) along `r` leaves it, and on which side. */
function tagExit(corners: [Point, Position][], o: Point, r: Point): { point: Point; side: Position } | null {
  const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
  let best: { t: number; side: Position } | null = null;
  corners.forEach(([a, side], i) => {
    const b = corners[(i + 1) % corners.length]![0];
    const s = { x: b.x - a.x, y: b.y - a.y };
    const denom = cross(r, s);
    if (!denom) return;
    const ao = { x: a.x - o.x, y: a.y - o.y };
    const t = cross(ao, s) / denom;
    const u = cross(ao, r) / denom;
    if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && (!best || t < best.t)) best = { t, side };
  });
  const hit = best as { t: number; side: Position } | null;
  return hit && { point: { x: o.x + r.x * hit.t, y: o.y + r.y * hit.t }, side: hit.side };
}

/**
 * Where the line from `node`'s centre (moved by `shift`) towards `other`'s centre (moved the same)
 * crosses `node`'s border, and on which side (a tag's slanted ends count as left / right).
 */
function intersection(node: InternalNode, other: InternalNode, shift = { x: 0, y: 0 }): Point & { side?: Position } {
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
  if (isTag(node)) {
    const exit = tagExit(tagCorners(p, w, h), { x: x2, y: y2 }, { x: dx, y: dy });
    if (exit) return { ...exit.point, side: exit.side };
  }
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

/** A declaration drawn as a row of its file's list (components/canvas/nodes.ts). */
const isRow = (n: InternalNode) => n.type === "card" && !!(n.data as { row?: unknown }).row;

/**
 * Where an edge meets a row: the middle of its left or right end, whichever faces the other node;
 * between two rows of one file, both on the left, so the bezier loops out through the gutter.
 */
function rowEnd(node: InternalNode, other: InternalNode, sameFile: boolean, shiftY: number): Point & { side: Position } {
  const { w, h } = sizeOf(node);
  const p = node.internals.positionAbsolute;
  const left = sameFile || centreOf(other).x < p.x + w / 2;
  const y = p.y + h / 2 + Math.max(-h * 0.3, Math.min(h * 0.3, shiftY));
  return { x: left ? p.x : p.x + w, y, side: left ? Position.Left : Position.Right };
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
  const sameFile = isRow(source) && isRow(target) && source.parentId === target.parentId;
  const s = isRow(source) ? rowEnd(source, target, sameFile, shift.y) : intersection(source, target, shift);
  const t = isRow(target) ? rowEnd(target, source, sameFile, shift.y) : intersection(target, source, shift);
  return { sx: s.x, sy: s.y, tx: t.x, ty: t.y, sourcePos: s.side ?? sideOf(source, s), targetPos: t.side ?? sideOf(target, t) };
}

const centreOf = (n: InternalNode) => {
  const { w, h } = sizeOf(n);
  return { x: n.internals.positionAbsolute.x + w / 2, y: n.internals.positionAbsolute.y + h / 2 };
};
