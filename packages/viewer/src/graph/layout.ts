import type { ElkNode } from "elkjs/lib/elk.bundled.js";
import type { DrawnElement, DrawnGraph } from "./drawn.ts";

/*
 * Full placement with ELK (layered, top → down), containers sized around what
 * they hold. Positions are relative to the container, as React Flow reads them.
 * Incremental changes and drags are handled by ./placement.ts; ELK runs for the
 * first placement, "Re-layout", and whenever a local placement can't settle.
 * Big diagrams (PACK_FROM elements) pack their top level instead: see packedLayout.
 */

export interface PlacedElement {
  element: DrawnElement;
  /** Whether other elements are drawn inside it (a frame). */
  holds: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const CARD_HEIGHT = 52;
const MIN_WIDTH = 240;
const MAX_WIDTH = 350;
/** Room for the name beside icon, boundary chip and the action buttons. */
export const widthOf = (name: string) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, name.length * 8.4 + 150));
/** A card's width: room for its name, plus its badges (each ≈ 7.2px a letter, padding and gap). */
export const cardWidthOf = (e: Pick<DrawnElement, "name" | "badges">) =>
  widthOf(e.name) + (e.badges ?? []).reduce((w, b) => w + b.length * 7.2 + 16, e.badges?.length ? 8 : 0);
/** A frame's least width: its header holds the name, role/boundary chips and six actions. */
export const frameWidthOf = (name: string) => widthOf(name) + 200;

/** Room at the top of a frame for its header, and around what it holds. */
export const PADDING = { top: 48, left: 14, bottom: 20, right: 14 } as const;
/** Room between two cards side by side. */
export const SPACING = 32;

let elk: Promise<{ layout: (g: ElkNode) => Promise<ElkNode> }> | null = null;
const loadElk = () => {
  elk ??= import("elkjs/lib/elk.bundled.js").then(({ default: ELK }) => new ELK());
  return elk;
};

const LAYERED = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.spacing.nodeNodeBetweenLayers": "64",
};

/** From this many drawn elements (with frames among them), the top level is packed (packedLayout). */
export const PACK_FROM = 300;

const framePadding = `[top=${PADDING.top},left=${PADDING.left},bottom=${PADDING.bottom},right=${PADDING.right}]`;

/** ELK nodes for elements and what they hold, each frame laid out layered around its contents. */
function elkNodes(graph: DrawnGraph) {
  const kids = new Map<string | null, DrawnElement[]>();
  for (const e of graph.elements) kids.set(e.parent, [...(kids.get(e.parent) ?? []), e]);
  const nodeOf = (e: DrawnElement): ElkNode => {
    const inside = kids.get(e.id) ?? [];
    if (!inside.length) return { id: e.id, width: cardWidthOf(e), height: CARD_HEIGHT };
    return {
      id: e.id,
      layoutOptions: {
        ...LAYERED,
        "elk.padding": framePadding,
        // Laying out downwards, ELK reads the pair as (height,width).
        "elk.nodeSize.minimum": `(${CARD_HEIGHT},${frameWidthOf(e.name)})`,
        "elk.nodeSize.constraints": "MINIMUM_SIZE",
      },
      children: inside.map(nodeOf),
    };
  };
  return { kids, nodeOf };
}

/** ELK's result as placed elements (container-relative); `lift` moves a synthetic group's contents to the top level. */
function placedFrom(graph: DrawnGraph, nodes: ElkNode[] = [], lift?: string): PlacedElement[] {
  const byId = new Map(graph.elements.map((e) => [e.id, e]));
  const out: PlacedElement[] = [];
  const walk = (list: ElkNode[] = [], dx = 0, dy = 0) => {
    for (const n of list) {
      if (n.id === lift) {
        walk(n.children, n.x ?? 0, n.y ?? 0);
        continue;
      }
      const element = byId.get(n.id);
      if (!element) continue;
      out.push({
        element,
        holds: (n.children?.length ?? 0) > 0,
        x: (n.x ?? 0) + dx,
        y: (n.y ?? 0) + dy,
        width: n.width ?? cardWidthOf(element),
        height: n.height ?? CARD_HEIGHT,
      });
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export async function layoutAll(graph: DrawnGraph): Promise<PlacedElement[]> {
  if (graph.elements.length >= PACK_FROM && graph.elements.some((e) => e.parent)) return packedLayout(graph);
  const { kids, nodeOf } = elkNodes(graph);
  const placed = await (await loadElk()).layout({
    id: "root",
    layoutOptions: {
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": String(SPACING),
      "elk.spacing.componentComponent": "48",
      ...LAYERED,
    },
    children: (kids.get(null) ?? []).map(nodeOf),
    edges: [...graph.relations.map(({ id, source, target }) => ({ id, sources: [source], targets: [target] })), ...gridEdges(graph)],
  });
  return placedFrom(graph, placed.children);
}

/** The synthetic group holding a packed layout's loose top-level cards (never drawn). */
const LOOSE = "\u0000loose";

/**
 * A big diagram, packed: laid out as one layered graph, its layers became rows of hundreds of
 * nodes (2,800 elements: 263,000 × 40,000 px, ~10 s). Instead each top-level frame is laid out
 * layered on its own (its relations inside), the loose top-level cards together in one layered
 * group (so they keep their flow), and those blocks are packed in file-path order — a folder's
 * files side by side — to about the viewport's shape (28,000 × 14,000 px, ~1 s). Relations
 * between blocks don't place them.
 */
async function packedLayout(graph: DrawnGraph): Promise<PlacedElement[]> {
  const { kids, nodeOf } = elkNodes(graph);
  const parentOf = new Map(graph.elements.map((e) => [e.id, e.parent]));
  const topOf = (id: string) => {
    let top = id;
    for (let p = parentOf.get(top); p; p = parentOf.get(top)) top = p;
    return top;
  };
  const tops = kids.get(null) ?? [];
  const loose = new Set(tops.filter((e) => !kids.has(e.id)).map((e) => e.id));
  const blockOf = (id: string) => {
    const top = topOf(id);
    return loose.has(top) ? LOOSE : top;
  };
  // each relation goes into the block holding both its ends; between blocks it's left out
  const edgesIn = new Map<string, { id: string; sources: string[]; targets: string[] }[]>();
  for (const r of [...graph.relations.map(({ id, source, target }) => ({ id, sources: [source], targets: [target] })), ...gridEdges(graph)]) {
    const block = blockOf(r.sources[0]!);
    if (block === blockOf(r.targets[0]!)) edgesIn.set(block, [...(edgesIn.get(block) ?? []), r]);
  }
  const frames = tops
    .filter((e) => !loose.has(e.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => {
      const n = nodeOf(e);
      return { ...n, layoutOptions: { ...n.layoutOptions, "elk.hierarchyHandling": "INCLUDE_CHILDREN", "elk.spacing.nodeNode": String(SPACING) }, edges: edgesIn.get(e.id) ?? [] };
    });
  const group: ElkNode[] = loose.size
    ? [
        {
          id: LOOSE,
          layoutOptions: { ...LAYERED, "elk.spacing.nodeNode": String(SPACING), "elk.spacing.componentComponent": "48" },
          children: tops.filter((e) => loose.has(e.id)).map(nodeOf),
          edges: edgesIn.get(LOOSE) ?? [],
        },
      ]
    : [];
  const placed = await (await loadElk()).layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "rectpacking",
      "elk.hierarchyHandling": "SEPARATE_CHILDREN",
      "elk.aspectRatio": "1.6",
      "elk.spacing.nodeNode": "48",
    },
    children: [...group, ...frames],
  });
  return placedFrom(graph, placed.children, LOOSE);
}

/**
 * What one container holds, laid out as if nothing else were drawn. Its direct
 * children are positioned from the corner of the area they cover.
 */
export async function layoutWithin(graph: DrawnGraph, id: string): Promise<PlacedElement[]> {
  const inside = new Set<string>();
  const gather = (p: string) => {
    for (const e of graph.elements) {
      if (e.parent !== p || inside.has(e.id)) continue;
      inside.add(e.id);
      gather(e.id);
    }
  };
  gather(id);
  const elements = await layoutAll({
    elements: graph.elements.filter((e) => inside.has(e.id)).map((e) => (e.parent === id ? { ...e, parent: null } : e)),
    relations: graph.relations.filter((r) => inside.has(r.source) && inside.has(r.target)),
  });
  const top = elements.filter((p) => p.element.parent === null);
  const left = Math.min(...top.map((p) => p.x));
  const up = Math.min(...top.map((p) => p.y));
  return elements.map((p) => (p.element.parent === null ? { ...p, x: p.x - left, y: p.y - up } : p));
}

/** Fans of more cards than this (one node's children or parents in one container) wrap into a grid. */
const GRID_FROM = 6;

/**
 * Hidden edges that wrap a big fan into rows: ELK's layered layout puts all of a node's children
 * (or parents) in one layer — one long row. Chaining card i to card i + columns pushes each next
 * batch one layer further, so 20 children make about 5 × 4 instead of a row of 20.
 * Only cards (no frames), in the same container, are wrapped.
 */
export function gridEdges(graph: DrawnGraph): { id: string; sources: string[]; targets: string[] }[] {
  const parentOf = new Map(graph.elements.map((e) => [e.id, e.parent]));
  const nameOf = new Map(graph.elements.map((e) => [e.id, e.name]));
  const frames = new Set(graph.elements.filter((e) => e.parent !== null).map((e) => e.parent!));
  const fans = new Map<string, Set<string>>();
  const add = (key: string, id: string) => {
    if (frames.has(id)) return;
    let fan = fans.get(key);
    if (!fan) fans.set(key, (fan = new Set()));
    fan.add(id);
  };
  for (const { source, target } of graph.relations) {
    add(`down\n${source}\n${parentOf.get(target) ?? ""}`, target);
    add(`up\n${target}\n${parentOf.get(source) ?? ""}`, source);
  }
  const out: { id: string; sources: string[]; targets: string[] }[] = [];
  const taken = new Set<string>();
  for (const [key, fan] of fans) {
    const ids = [...fan].filter((id) => !taken.has(id)).sort((a, b) => (nameOf.get(a) ?? a).localeCompare(nameOf.get(b) ?? b));
    if (ids.length <= GRID_FROM) continue;
    for (const id of ids) taken.add(id);
    const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
    for (let i = 0; i + cols < ids.length; i++) out.push({ id: `grid:${key}:${i}`, sources: [ids[i]!], targets: [ids[i + cols]!] });
  }
  return out;
}
