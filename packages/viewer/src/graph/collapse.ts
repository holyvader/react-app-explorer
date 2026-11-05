import type { PlacedElement } from "./layout.ts";

/**
 * Zoomed far out, frames are drawn as single blocks (their contents hidden) and the relations
 * between blocks merge into one edge per pair: thousands of nodes and edges become tens or hundreds.
 * Nothing moves: a collapsed frame keeps its place and size. Pure, so the canvas only maps it.
 * - "files": frames holding only cards (file modules, and folders / routes of plain cards).
 * - "all": every top-level frame (and with it everything inside).
 */
export type CollapseLevel = "none" | "files" | "all";

export interface Collapse {
  /** Collapsed frame → how many drawn elements it hides. */
  frames: Map<string, number>;
  /** Hidden element → the collapsed frame drawn in its place. */
  shownAs: Map<string, string>;
}

const NONE: Collapse = { frames: new Map(), shownAs: new Map() };

export function collapseFrames(placed: PlacedElement[], level: CollapseLevel): Collapse {
  if (level === "none") return NONE;
  const kids = new Map<string, string[]>();
  const holds = new Set<string>();
  for (const p of placed) {
    if (p.holds) holds.add(p.element.id);
    if (p.element.parent) kids.set(p.element.parent, [...(kids.get(p.element.parent) ?? []), p.element.id]);
  }
  const collapsed =
    level === "all"
      ? placed.filter((p) => p.holds && !p.element.parent).map((p) => p.element.id)
      : [...holds].filter((id) => (kids.get(id) ?? []).every((k) => !holds.has(k)));
  const frames = new Map<string, number>();
  const shownAs = new Map<string, string>();
  for (const frame of collapsed) {
    let count = 0;
    const hide = (id: string) => {
      for (const k of kids.get(id) ?? []) {
        shownAs.set(k, frame);
        count++;
        hide(k);
      }
    };
    hide(frame);
    if (count) frames.set(frame, count);
  }
  return frames.size ? { frames, shownAs } : NONE;
}

export interface Bundle<R> {
  source: string;
  target: string;
  members: R[];
}

/**
 * Relations as drawn under a collapse: those between shown elements stay; the others connect the
 * blocks in their ends' place, merged per (source, target) block pair; inside one block they're gone.
 */
export function bundleRelations<R extends { source: string; target: string }>(relations: R[], collapse: Collapse): { kept: R[]; bundles: Bundle<R>[] } {
  if (!collapse.shownAs.size) return { kept: relations, bundles: [] };
  const kept: R[] = [];
  const bundles = new Map<string, Bundle<R>>();
  for (const r of relations) {
    const source = collapse.shownAs.get(r.source) ?? r.source;
    const target = collapse.shownAs.get(r.target) ?? r.target;
    if (source === r.source && target === r.target) kept.push(r);
    else if (source !== target) {
      const key = `${source}\n${target}`;
      const b = bundles.get(key);
      if (b) b.members.push(r);
      else bundles.set(key, { source, target, members: [r] });
    }
  }
  return { kept, bundles: [...bundles.values()] };
}
