import type { DrawnElement } from "./drawn.ts";

/*
 * Sizes shared by the placements: the full one (./squareLayout.ts — Re-layout, Tidy up, first draw)
 * and the local one (./placement.ts — adding beside an anchor, drags).
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
/** How far each end of a component card (a tag, `< >`) comes to a point (px). Also `--tag-depth` in canvas.css. */
export const TAG_DEPTH = 13;
const MIN_WIDTH = 240;
const MAX_WIDTH = 350;
/** Room for the name beside icon, boundary chip and the action buttons. */
export const widthOf = (name: string) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, name.length * 8.4 + 150));
/** A component's name is written `<Name />` (no icon) and its ends are pointed: this much wider. */
const COMPONENT_EXTRA = 20;
/** A card's width: room for its name, plus its badges (each ≈ 7.2px a letter, padding and gap). */
export const cardWidthOf = (e: Pick<DrawnElement, "name" | "badges"> & { kind?: DrawnElement["kind"] }) =>
  widthOf(e.name) +
  (e.kind === "component" ? COMPONENT_EXTRA : 0) +
  (e.badges ?? []).reduce((w, b) => w + b.length * 7.2 + 16, e.badges?.length ? 8 : 0);
/** A frame's least width: its header holds the name, role/boundary chips and seven actions. */
export const frameWidthOf = (name: string) => widthOf(name) + 224;

/** Room at the top of a frame for its header, and around what it holds. */
export const PADDING = { top: 48, left: 14, bottom: 20, right: 14 } as const;
/** Room between two cards side by side. */
export const SPACING = 32;
