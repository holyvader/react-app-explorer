import type { DrawnElement, DrawnKind } from "./drawn.ts";

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

// ---- file frames: a module's declarations as a locked list ---------------------------------------

/**
 * A file frame (a module with its declarations drawn) is a list: a 62px header (the file name, its
 * folder dimmed below), then one 30px row per declaration in a fixed order — types, components,
 * hooks, server actions, functions, each A to Z — with 8px (a hairline) between groups. Rows span
 * the frame's width and can't be dragged: the file moves as one. Every placement lays them out
 * with `fileListOf`, so they always stand there.
 */
export const FILE_HEADER = 62;
export const ROW_HEIGHT = 30;
export const GROUP_GAP = 8;
/** Room round a file's rows: the header (+6), none at the sides (rows span the frame), 8 below. */
export const FILE_PADDING = { top: FILE_HEADER + 6, left: 0, bottom: 8, right: 0 } as const;
const FILE_MIN = 260;
const FILE_MAX = 380;

export const isFileFrame = (e: Pick<DrawnElement, "kind"> | undefined | null) => e?.kind === "module";
/** The room round what a frame holds: a file's, or a folder's / route's. */
export const paddingOf = (e: Pick<DrawnElement, "kind"> | undefined | null) => (isFileFrame(e) ? FILE_PADDING : PADDING);
/** A frame's least width: a file's is its list's (`fileListOf`), a folder's / route's its header's. */
export const leastWidthOf = (e: Pick<DrawnElement, "kind" | "name">) => (isFileFrame(e) ? 0 : frameWidthOf(e.name));

const RANK: Partial<Record<DrawnKind, number>> = { type: 0, component: 1, hook: 2, serverAction: 3, function: 4 };
/** A row's group in a file: types, components, hooks, server actions, functions, anything else. */
export const rowRank = (e: Pick<DrawnElement, "kind">) => RANK[e.kind] ?? 5;
/** A file's rows in order: by group, then A to Z (ignoring case). */
export const rowOrder = <T extends Pick<DrawnElement, "kind" | "name" | "id">>(kids: readonly T[]): T[] =>
  [...kids].sort((a, b) => rowRank(a) - rowRank(b) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));

/** A row's width: icon, name (`<Name />` for components), a word of meta, its badges. */
const rowWidthOf = (e: Pick<DrawnElement, "kind" | "name" | "badges">) =>
  14 + 14 + 8 + (e.kind === "component" ? e.name.length + 4 : e.name.length) * 7.4 + 64 + (e.badges ?? []).reduce((w, b) => w + b.length * 6.6 + 20, 0) + 12;
/**
 * The header's width: icon, the file's name at 16px, room for its chips (client / server, a Next
 * role) and the lock. Its folder path isn't counted: a long one ends in an ellipsis (whole on hover).
 */
const headerWidthOf = (file: Pick<DrawnElement, "name">) => 14 + 16 + 9 + file.name.length * 9.6 + 9 + 64 + 9 + 13 + 12;

export interface FileList {
  /** The frame's width, and the rows' (they span it). */
  width: number;
  /** How tall the rows are together (the frame adds FILE_PADDING round them). */
  innerHeight: number;
  /** Each row in order: its top inside the frame's room, and whether a group starts there. */
  rows: { element: DrawnElement; y: number; groupStart: boolean }[];
}

/** A file's rows laid out (see FILE_HEADER): in order, one under another, a gap between groups. */
export function fileListOf(file: Pick<DrawnElement, "name">, kids: readonly DrawnElement[]): FileList {
  const rows: FileList["rows"] = [];
  let y = 0;
  let rank: number | undefined;
  for (const e of rowOrder(kids)) {
    const r = rowRank(e);
    const groupStart = rank !== undefined && r !== rank;
    if (groupStart) y += GROUP_GAP;
    rows.push({ element: e, y, groupStart });
    y += ROW_HEIGHT;
    rank = r;
  }
  const width = Math.round(Math.min(FILE_MAX, Math.max(FILE_MIN, headerWidthOf(file), ...kids.map(rowWidthOf))));
  return { width, innerHeight: y, rows };
}
