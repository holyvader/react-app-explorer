import type { DrawnElement, DrawnGraph } from "./drawn.ts";
import { CARD_HEIGHT, frameWidthOf, PADDING, type PlacedElement, SPACING, widthOf } from "./layout.ts";

/*
 * Incremental placement, after the system model explorer in noesis:
 *
 * - What stays keeps its place; what is gone is only gone.
 * - What comes is set beside the node the change came from, in the nearest free
 *   spot — inside its container when it has one drawn. The container grows to
 *   hold it (keeping its top-left corner) and pushes aside whatever it reaches,
 *   then its own container fits around it, and so on up.
 * - A container that appears around elements already drawn is drawn around them.
 * - A dragged element stays at its own level: let go of inside another frame, it
 *   lands just outside that frame. Siblings it now overlaps are shoved away,
 *   and its container refits (grows or shrinks) around what it holds.
 * - A container left with fewer children closes the gap at its top and shrinks.
 *
 * Work happens in absolute canvas coordinates, converted back to container-
 * relative positions at the end. `null` means "can't settle locally": the caller
 * falls back to a full ELK layout.
 */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

/** How close two cards may come without overlapping. */
const MARGIN = SPACING / 2;
/** Pushes one change may take before giving up and laying out anew. */
const PUSHES = 500;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width + MARGIN && b.x < a.x + a.width + MARGIN && a.y < b.y + b.height + MARGIN && b.y < a.y + a.height + MARGIN;
const centreOf = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
};
const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const encloses = (r: Rect, p: CanvasPoint) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

function workspaceOf(previous: readonly PlacedElement[], graph: DrawnGraph) {
  const before = new Map(previous.map((p) => [p.element.id, p]));
  const absolute = new Map<string, Rect>();
  const absoluteOf = (id: string): Rect | null => {
    const known = absolute.get(id);
    if (known) return known;
    const p = before.get(id);
    if (!p) return null;
    const parent = p.element.parent === null ? null : absoluteOf(p.element.parent);
    const r = { x: p.x + (parent?.x ?? 0), y: p.y + (parent?.y ?? 0), width: p.width, height: p.height };
    absolute.set(id, r);
    return r;
  };

  const byId = new Map(graph.elements.map((e) => [e.id, e]));
  const children = new Map<string | null, DrawnElement[]>();
  for (const e of graph.elements) children.set(e.parent, [...(children.get(e.parent) ?? []), e]);
  const kidsOf = (id: string | null) => children.get(id) ?? [];

  // What stays keeps its place; a frame left holding nothing becomes a card again.
  const rects = new Map<string, Rect>();
  const resized: { id: string; old: Rect }[] = [];
  for (const e of graph.elements) {
    const r = absoluteOf(e.id);
    const was = before.get(e.id);
    if (!r || !was) continue;
    const next = kidsOf(e.id).length === 0 && was.holds ? { ...r, width: widthOf(e.name), height: CARD_HEIGHT } : r;
    rects.set(e.id, next);
    if (!same(next, r)) resized.push({ id: e.id, old: r });
  }

  const placedKids = (id: string | null) => kidsOf(id).filter((k) => rects.has(k.id));
  const descendantsOf = (id: string): string[] => kidsOf(id).flatMap((k) => [k.id, ...descendantsOf(k.id)]);
  const ancestorsOf = (id: string): string[] => {
    const p = byId.get(id)?.parent ?? null;
    return p === null ? [] : [p, ...ancestorsOf(p)];
  };

  let pushes = 0;
  const move = (id: string, dx: number, dy: number) => {
    for (const each of [id, ...descendantsOf(id)]) {
      const r = rects.get(each);
      if (r) rects.set(each, { ...r, x: r.x + dx, y: r.y + dy });
    }
  };

  /** Siblings the element now overlaps move off it — the way they mostly lie from it — cascading. `kept` never moves. */
  const shove = (id: string, kept: string): boolean => {
    const self = rects.get(id);
    if (!self) return true;
    for (const { id: other } of placedKids(byId.get(id)?.parent ?? null)) {
      if (other === id || other === kept) continue;
      const r = rects.get(other);
      if (!r || !overlaps(self, r)) continue;
      if (++pushes > PUSHES) return false;
      const from = centreOf(self);
      const to = centreOf(r);
      const [dx, dy] =
        Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
          ? [to.x >= from.x ? self.x + self.width + SPACING - r.x : self.x - SPACING - (r.x + r.width), 0]
          : [0, to.y >= from.y ? self.y + self.height + SPACING - r.y : self.y - SPACING - (r.y + r.height)];
      move(other, dx, dy);
      if (!shove(other, kept)) return false;
    }
    return true;
  };

  /** A grown element pushes aside siblings it now covers: right if they were right of it, down if below. */
  const pushAround = (id: string, old: Rect): boolean => {
    const grown = rects.get(id);
    if (!grown) return true;
    for (const { id: other } of placedKids(byId.get(id)?.parent ?? null)) {
      if (other === id) continue;
      const r = rects.get(other);
      if (!r || !overlaps(grown, r)) continue;
      if (++pushes > PUSHES) return false;
      const right = grown.x + grown.width + SPACING - r.x;
      const down = grown.y + grown.height + SPACING - r.y;
      const [dx, dy] = r.x >= old.x + old.width ? [right, 0] : r.y >= old.y + old.height ? [0, down] : right <= down ? [right, 0] : [0, down];
      move(other, dx, dy);
      if (!pushAround(other, r)) return false;
    }
    return true;
  };

  /** Grows a container around everything it holds (never shrinks), then its container around it. */
  const fit = (id: string | null): boolean => {
    if (id === null) return true;
    const old = rects.get(id);
    const e = byId.get(id);
    if (!old || !e) return true;
    let next = old;
    for (const { id: kid } of placedKids(id)) {
      const r = rects.get(kid)!;
      next = union(next, {
        x: r.x - PADDING.left,
        y: r.y - PADDING.top,
        width: r.width + PADDING.left + PADDING.right,
        height: r.height + PADDING.top + PADDING.bottom,
      });
    }
    if (next.width < frameWidthOf(e.name)) next = { ...next, width: frameWidthOf(e.name) };
    if (same(next, old)) return true;
    rects.set(id, next);
    return pushAround(id, old) && fit(e.parent);
  };

  /** Fits a container to what it holds, larger or smaller, keeping its top-left corner; then up the chain. */
  const refit = (id: string | null): boolean => {
    if (id === null) return true;
    const old = rects.get(id);
    const e = byId.get(id);
    if (!old || !e) return true;
    const held = placedKids(id).map((k) => rects.get(k.id)!);
    if (!held.length) return refit(e.parent);
    const box = held.slice(1).reduce(union, held[0]!);
    const x = Math.min(old.x, box.x - PADDING.left);
    const y = Math.min(old.y, box.y - PADDING.top);
    const next = {
      x,
      y,
      width: Math.max(frameWidthOf(e.name), box.x + box.width + PADDING.right - x),
      height: Math.max(CARD_HEIGHT, box.y + box.height + PADDING.bottom - y),
    };
    if (same(next, old)) return true;
    rects.set(id, next);
    return pushAround(id, old) && refit(e.parent);
  };

  /** Children raised together to the top of their container's room, closing a gap left by what went. */
  const lift = (id: string) => {
    const frame = rects.get(id);
    const held = placedKids(id);
    if (!frame || !held.length) return;
    const top = Math.min(...held.map((k) => rects.get(k.id)!.y));
    const gap = top - (frame.y + PADDING.top);
    if (gap > 0) for (const k of held) move(k.id, 0, -gap);
  };

  // Containers something left (removed, or re-parented) are fitted to what they still hold.
  const now = new Map(graph.elements.map((e) => [e.id, e.parent]));
  const leftBehind = new Set<string>();
  for (const { element } of previous) {
    if (element.parent !== null && rects.has(element.parent) && now.get(element.id) !== element.parent) leftBehind.add(element.parent);
  }

  const settle = () =>
    resized.every(({ id, old }) => fit(kidsOf(id).length > 0 ? id : null) && pushAround(id, old) && fit(byId.get(id)?.parent ?? null)) &&
    [...leftBehind].every((id) => (lift(id), refit(id)));

  /** Every element relative to its container, containers first. */
  const placed = (): PlacedElement[] => {
    const out: PlacedElement[] = [];
    const walk = (parent: string | null) => {
      const origin = parent === null ? null : rects.get(parent)!;
      for (const e of kidsOf(parent)) {
        const r = rects.get(e.id)!;
        out.push({ element: e, holds: kidsOf(e.id).length > 0, x: r.x - (origin?.x ?? 0), y: r.y - (origin?.y ?? 0), width: r.width, height: r.height });
        walk(e.id);
      }
    };
    walk(null);
    return out;
  };

  return { rects, byId, kidsOf, placedKids, descendantsOf, ancestorsOf, move, fit, refit, pushAround, shove, settle, placed };
}

type Workspace = ReturnType<typeof workspaceOf>;

export interface PlaceOptions {
  /**
   * Which side of the anchor new elements go: "down" (its children, below it), "up" (its parents,
   * above it). Unset: wherever is nearest.
   */
  direction?: "up" | "down";
}

/** Columns for a grid of `n` cards: about square in count, so 20 cards make 5 × 4, not one long row. */
export const gridColumns = (n: number) => Math.max(1, Math.ceil(Math.sqrt(n)));

/**
 * Places the changed graph without moving the rest. `anchor`: the node the change
 * came from, a canvas point (e.g. viewport centre), or null (near everything).
 * Several new cards going into the same container (or onto the canvas) are set out together as a
 * grid, in a free spot beside the anchor.
 */
export function placeLocally(previous: readonly PlacedElement[], graph: DrawnGraph, anchor: string | CanvasPoint | null, opts: PlaceOptions = {}): PlacedElement[] | null {
  const ws = workspaceOf(previous, graph);
  const { rects, placedKids, descendantsOf, ancestorsOf, fit, settle, placed } = ws;
  if (!settle()) return null;
  const point = anchor !== null && typeof anchor === "object" ? anchor : null;
  const card = typeof anchor === "string" && rects.has(anchor) ? anchor : null;

  const anchorRect: Rect =
    (point ? { ...point, width: 0, height: 0 } : undefined) ??
    (card ? rects.get(card) : undefined) ??
    [...rects.values()].reduce<Rect | null>((all, r) => (all ? union(all, r) : r), null) ?? { x: 0, y: 0, width: 0, height: 0 };
  const distanceTo = (toward: Rect) => (r: Rect) => {
    const a = centreOf(r);
    const b = centreOf(toward);
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  /** The free spot for a card of this size nearest the anchor. Inside a container: never above/left of its room. */
  const spotFor = (width: number, height: number, around: Rect[], standing: Rect[], start: CanvasPoint | null, room: Rect | null, toward: Rect = anchorRect): Rect => {
    const near = distanceTo(toward);
    const at = (x: number, y: number) => ({ x, y, width, height });
    const candidates = [
      ...(start ? [at(start.x, start.y)] : []),
      ...around.flatMap((r) => [
        at(r.x + r.width + SPACING, r.y),
        at(r.x, r.y + r.height + SPACING),
        at(r.x - SPACING - width, r.y),
        at(r.x, r.y - SPACING - height),
        // centred under / over it (a grid of children under their parent)
        at(r.x + r.width / 2 - width / 2, r.y + r.height + SPACING),
        at(r.x + r.width / 2 - width / 2, r.y - SPACING - height),
      ]),
    ];
    const free = candidates.filter((s) => (!room || (s.x >= room.x && s.y >= room.y)) && standing.every((r) => !overlaps(s, r)));
    const outsideRoom = (s: Rect) =>
      !room || (s.x >= room.x && s.y >= room.y && s.x + s.width <= room.x + room.width && s.y + s.height <= room.y + room.height) ? 0 : 1;
    // parents above the anchor, children below it, when there's room there
    const wrongSide = (s: Rect) =>
      opts.direction === "down" ? (s.y < toward.y + toward.height ? 1 : 0) : opts.direction === "up" ? (s.y + s.height > toward.y ? 1 : 0) : 0;
    return (
      free.sort((a, b) => outsideRoom(a) - outsideRoom(b) || wrongSide(a) - wrongSide(b) || near(a) - near(b))[0] ??
      at(Math.max(...standing.map((r) => r.x + r.width), 0) + SPACING, room?.y ?? anchorRect.y)
    );
  };

  const place = (e: DrawnElement): boolean => {
    const held = placedKids(e.id).map((k) => rects.get(k.id)!);
    if (held.length) {
      // A container around what is already drawn of it.
      const box = held.slice(1).reduce(union, held[0]!);
      const r = {
        x: box.x - PADDING.left,
        y: box.y - PADDING.top,
        width: Math.max(frameWidthOf(e.name), box.width + PADDING.left + PADDING.right),
        height: box.height + PADDING.top + PADDING.bottom,
      };
      const own = new Set([...descendantsOf(e.id), ...ancestorsOf(e.id)]);
      for (const [id, other] of rects) if (!own.has(id) && overlaps(r, other)) return false;
      rects.set(e.id, r);
      return fit(e.parent);
    }
    const width = widthOf(e.name);
    if (e.parent !== null) {
      const container = rects.get(e.parent);
      if (!container) return false;
      const siblings = placedKids(e.parent)
        .filter((k) => k.id !== e.id)
        .map((k) => rects.get(k.id)!);
      const room = {
        x: container.x + PADDING.left,
        y: container.y + PADDING.top,
        width: container.width - PADDING.left - PADDING.right,
        height: container.height - PADDING.top - PADDING.bottom,
      };
      rects.set(e.id, spotFor(width, CARD_HEIGHT, siblings, siblings, siblings.length ? null : { x: room.x, y: room.y }, room));
      return fit(e.parent);
    }
    const roots = placedKids(null).map((k) => rects.get(k.id)!);
    if (point) {
      rects.set(e.id, spotFor(width, CARD_HEIGHT, roots, roots, { x: point.x - width / 2, y: point.y - CARD_HEIGHT / 2 }, null));
      return true;
    }
    const top = card === null ? null : (ancestorsOf(card).at(-1) ?? card);
    const from = (top ? rects.get(top) : undefined) ?? anchorRect;
    rects.set(e.id, spotFor(width, CARD_HEIGHT, [from, ...roots], roots, null, null));
    return true;
  };

  /** New cards with the same container, set out as one grid block in the spot a card would get. */
  const placeGrid = (group: DrawnElement[]): boolean => {
    const parent = group[0]!.parent;
    const sorted = [...group].sort((a, b) => a.name.localeCompare(b.name));
    const cols = gridColumns(sorted.length);
    const rows = Math.ceil(sorted.length / cols);
    const cell = Math.max(...sorted.map((e) => widthOf(e.name)));
    const width = cols * cell + (cols - 1) * SPACING;
    const height = rows * CARD_HEIGHT + (rows - 1) * SPACING;
    let spot: Rect;
    if (parent !== null) {
      const container = rects.get(parent);
      if (!container) return false;
      const siblings = placedKids(parent).map((k) => rects.get(k.id)!);
      const room = { x: container.x + PADDING.left, y: container.y + PADDING.top, width: container.width - PADDING.left - PADDING.right, height: container.height - PADDING.top - PADDING.bottom };
      spot = spotFor(width, height, siblings, siblings, siblings.length ? null : { x: room.x, y: room.y }, room);
    } else {
      const roots = placedKids(null).map((k) => rects.get(k.id)!);
      if (point) spot = spotFor(width, height, roots, roots, { x: point.x - width / 2, y: point.y - height / 2 }, null);
      else {
        const top = card === null ? null : (ancestorsOf(card).at(-1) ?? card);
        const from = (top ? rects.get(top) : undefined) ?? anchorRect;
        spot = spotFor(width, height, [from, ...roots], roots, null, null);
      }
    }
    sorted.forEach((e, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      rects.set(e.id, { x: spot.x + c * (cell + SPACING), y: spot.y + r * (CARD_HEIGHT + SPACING), width: widthOf(e.name), height: CARD_HEIGHT });
    });
    return fit(parent);
  };

  // Each new element once its container stands, so it has a room to go in. New cards sharing a
  // container go in together, as a grid.
  const holdsKids = new Set(graph.elements.filter((e) => e.parent !== null).map((e) => e.parent!));
  const waiting = graph.elements.filter((e) => !rects.has(e.id));
  while (waiting.length) {
    const i = waiting.findIndex((e) => e.parent === null || rects.has(e.parent));
    if (i < 0) return null;
    const e = waiting[i]!;
    const group = holdsKids.has(e.id) ? [e] : waiting.filter((w) => w.parent === e.parent && !holdsKids.has(w.id));
    if (group.length > 1) {
      for (const g of group) waiting.splice(waiting.indexOf(g), 1);
      if (!placeGrid(group)) return null;
      continue;
    }
    waiting.splice(i, 1);
    if (!place(e)) return null;
  }
  return placed();
}

/** What a container holds set out anew (as `inside` lays it), the container fitted to it; the rest stays put. */
export function arrangeWithin(previous: readonly PlacedElement[], graph: DrawnGraph, id: string, inside: readonly PlacedElement[]): PlacedElement[] | null {
  const { rects, byId, kidsOf, pushAround, fit, settle, placed } = workspaceOf(previous, graph);
  if (!settle()) return null;
  const frame = rects.get(id);
  const e = byId.get(id);
  if (!frame || !e) return null;
  const at = new Map(inside.map((p) => [p.element.id, p]));
  let right = frame.x + frameWidthOf(e.name);
  let bottom = frame.y + CARD_HEIGHT;
  const set = (parent: string, from: CanvasPoint): boolean => {
    for (const { id: kid } of kidsOf(parent)) {
      const laid = at.get(kid);
      if (!laid) return false;
      const r = { x: from.x + laid.x, y: from.y + laid.y, width: laid.width, height: laid.height };
      rects.set(kid, r);
      right = Math.max(right, r.x + r.width + PADDING.right);
      bottom = Math.max(bottom, r.y + r.height + PADDING.bottom);
      if (!set(kid, r)) return false;
    }
    return true;
  };
  if (!set(id, { x: frame.x + PADDING.left, y: frame.y + PADDING.top })) return null;
  rects.set(id, { ...frame, width: right - frame.x, height: bottom - frame.y });
  return pushAround(id, frame) && fit(e.parent) ? placed() : null;
}

export interface CanvasFrame extends Rect {
  id: string;
}

/** Frames an element may not land in: those around others, neither around it nor inside it. */
function refusing(ws: Workspace, graph: DrawnGraph, id: string): CanvasFrame[] {
  const own = new Set([id, ...ws.descendantsOf(id), ...ws.ancestorsOf(id)]);
  return graph.elements
    .filter((e) => !own.has(e.id) && ws.placedKids(e.id).length > 0)
    .flatMap((e) => {
      const r = ws.rects.get(e.id);
      return r ? [{ id: e.id, ...r }] : [];
    });
}

export function refusingFrames(previous: readonly PlacedElement[], graph: DrawnGraph, id: string): CanvasFrame[] {
  return refusing(workspaceOf(previous, graph), graph, id);
}

/** The innermost refused frame a card standing at `rect` would land in (its centre inside), if any. */
export function landsIn(frames: readonly CanvasFrame[], rect: Rect): CanvasFrame | undefined {
  const c = centreOf(rect);
  return frames.filter((f) => encloses(f, c)).sort((a, b) => a.width * a.height - b.width * b.height)[0];
}

/**
 * An element (with all it holds) dropped at `to` (absolute). It stays inside its
 * container; let go of inside another frame, it lands at that frame's nearest free
 * side. What it then overlaps makes way, and its container refits.
 */
export function movedTo(previous: readonly PlacedElement[], graph: DrawnGraph, id: string, to: CanvasPoint): PlacedElement[] | null {
  const ws = workspaceOf(previous, graph);
  const { rects, byId, move, refit, shove, settle, placed } = ws;
  if (!settle()) return null;
  const from = rects.get(id);
  if (!from) return null;
  const frames = refusing(ws, graph, id);
  const dropped = { ...from, ...to };
  // The outermost refused frame it was let go of in: outside that, it's back at its own level.
  const into = frames.filter((f) => encloses(f, centreOf(dropped))).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  let at: Rect = dropped;
  if (into) {
    const sides = [
      { ...dropped, x: into.x - SPACING - dropped.width },
      { ...dropped, x: into.x + into.width + SPACING },
      { ...dropped, y: into.y - SPACING - dropped.height },
      { ...dropped, y: into.y + into.height + SPACING },
    ];
    const distance = (r: Rect) => Math.hypot(r.x - dropped.x, r.y - dropped.y);
    const byNearness = sides.sort((a, b) => distance(a) - distance(b));
    at = byNearness.find((s) => frames.every((f) => !overlaps(s, f))) ?? byNearness[0]!;
  }
  move(id, at.x - from.x, at.y - from.y);
  if (!shove(id, id)) return null;
  return refit(byId.get(id)?.parent ?? null) ? placed() : null;
}

/** Absolute canvas rect of a placed element. */
export function absoluteRect(placed: readonly PlacedElement[], id: string): Rect | undefined {
  const byId = new Map(placed.map((p) => [p.element.id, p]));
  let p = byId.get(id);
  if (!p) return undefined;
  const r = { x: 0, y: 0, width: p.width, height: p.height };
  while (p) {
    r.x += p.x;
    r.y += p.y;
    p = p.element.parent === null ? undefined : byId.get(p.element.parent);
  }
  return r;
}

/**
 * A file module holding a single element places it automatically: at the top-left of its room,
 * the frame fitted around it (keeping its top-left corner). The frame only ever shrinks here,
 * so nothing around it needs pushing. Folders are left alone (their contents move freely).
 */
export function autoPlaceSoleChildren(placed: PlacedElement[]): PlacedElement[] {
  const kids = new Map<string, PlacedElement[]>();
  for (const p of placed) if (p.element.parent) kids.set(p.element.parent, [...(kids.get(p.element.parent) ?? []), p]);
  const fixed = new Map<string, PlacedElement>();
  for (const p of placed) {
    const inside = kids.get(p.element.id);
    if (p.element.kind !== "module" || inside?.length !== 1) continue;
    const only = inside[0]!;
    const width = Math.max(frameWidthOf(p.element.name), only.width + PADDING.left + PADDING.right);
    const height = only.height + PADDING.top + PADDING.bottom;
    if (only.x !== PADDING.left || only.y !== PADDING.top) fixed.set(only.element.id, { ...only, x: PADDING.left, y: PADDING.top });
    if (p.width !== width || p.height !== height) fixed.set(p.element.id, { ...p, width, height });
  }
  return fixed.size ? placed.map((p) => fixed.get(p.element.id) ?? p) : placed;
}
