import type { ElkNode } from "elkjs/lib/elk.bundled.js";
import type { DrawnElement, DrawnGraph } from "./drawn.ts";

/*
 * Full placement with ELK (layered, top → down), containers sized around what
 * they hold. Positions are relative to the container, as React Flow reads them.
 * Incremental changes and drags are handled by ./placement.ts; ELK runs for the
 * first placement, "Re-layout", and whenever a local placement can't settle.
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

export const CARD_HEIGHT = 64;
const MIN_WIDTH = 230;
const MAX_WIDTH = 320;
/** Room for the name beside icon, boundary chip and the action buttons. */
export const widthOf = (name: string) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, name.length * 7.5 + 150));
/** A frame's least width: its header holds the name, role/boundary chips and six actions. */
export const frameWidthOf = (name: string) => widthOf(name) + 200;

/** Room at the top of a frame for its header, and around what it holds. */
export const PADDING = { top: 60, left: 16, bottom: 20, right: 16 } as const;
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

export async function layoutAll(graph: DrawnGraph): Promise<PlacedElement[]> {
  const kids = new Map<string | null, DrawnElement[]>();
  for (const e of graph.elements) kids.set(e.parent, [...(kids.get(e.parent) ?? []), e]);

  const nodeOf = (e: DrawnElement): ElkNode => {
    const inside = kids.get(e.id) ?? [];
    if (!inside.length) return { id: e.id, width: widthOf(e.name), height: CARD_HEIGHT };
    return {
      id: e.id,
      layoutOptions: {
        ...LAYERED,
        "elk.padding": `[top=${PADDING.top},left=${PADDING.left},bottom=${PADDING.bottom},right=${PADDING.right}]`,
        // Laying out downwards, ELK reads the pair as (height,width).
        "elk.nodeSize.minimum": `(${CARD_HEIGHT},${frameWidthOf(e.name)})`,
        "elk.nodeSize.constraints": "MINIMUM_SIZE",
      },
      children: inside.map(nodeOf),
    };
  };

  const placed = await (await loadElk()).layout({
    id: "root",
    layoutOptions: {
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": String(SPACING),
      "elk.spacing.componentComponent": "48",
      ...LAYERED,
    },
    children: (kids.get(null) ?? []).map(nodeOf),
    edges: graph.relations.map(({ id, source, target }) => ({ id, sources: [source], targets: [target] })),
  });

  const byId = new Map(graph.elements.map((e) => [e.id, e]));
  const out: PlacedElement[] = [];
  const walk = (nodes: ElkNode[] = []) => {
    for (const n of nodes) {
      const element = byId.get(n.id);
      if (!element) continue;
      out.push({
        element,
        holds: (n.children?.length ?? 0) > 0,
        x: n.x ?? 0,
        y: n.y ?? 0,
        width: n.width ?? widthOf(element.name),
        height: n.height ?? CARD_HEIGHT,
      });
      walk(n.children);
    }
  };
  walk(placed.children);
  return out;
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
