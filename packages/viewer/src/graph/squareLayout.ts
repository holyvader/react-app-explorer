import { type DrawnElement, type DrawnGraph, type DrawnKind, FOLDER_PREFIX } from "./drawn.ts";
import { CARD_HEIGHT, cardWidthOf, frameWidthOf, PADDING, type PlacedElement } from "./layout.ts";

/*
 * Full placement by relations (after noesis' layout-by-relations): each container's elements are set
 * out in a square — rows, as wide as makes the whole squarest — in the order that tangles the edges
 * least: fewest running through a card that is neither of their ends, then fewest crossing each
 * other, then the shortest.
 *
 * Files from one folder stay together: a container's elements are first put in blocks following the
 * folder tree (invisible), each block set out in a square, the blocks in a square in turn, further
 * apart. Libraries make one block, routes another.
 *
 * In `tree` mode, a container of files is set out tree-like instead (`withTreeBlocks`): levels down
 * the relations, callers above what they call; what hangs under one element is a square block under
 * it; the levels one under another. Folder blocks still come first: a tree is grown inside each.
 *
 * It is a search, not a formula. It starts with what is joined set side by side (the element joined
 * to most first, then each time the one joined most to those already set out) or a force-directed
 * embedding, then tries each two elements of a container (a block counts as one) in each other's
 * place, and a column more or fewer than its squarest shape — the whole placed anew and read each
 * time — and keeps a change that tangles it less; until none does; then shakes a container and
 * climbs again while there's time (iterated local search). Outer containers are searched first:
 * their order decides the most. A container's packing is kept between tries, so a try sets out again
 * only the container it changed and those round it.
 *
 * Edges are read as the canvas draws them (graph/floating.ts): a straight line between the centres
 * of their two ends. Positions come out relative to the container, as React Flow reads them.
 */

/** How long the search may go on, and how many placings it may try. */
interface SearchLimit {
  ms: number;
  tries: number;
}
export type LayoutEffort = "thorough" | "quick";
/** `square`: each container's elements in a square. `tree`: files in levels, callers above what they call (see `withTreeBlocks`). */
export type LayoutMode = "square" | "tree";
const LIMITS: Record<LayoutEffort, SearchLimit> = {
  /** A placing the reader asked for (Re-layout, Tidy up): worth a moment's wait. */
  thorough: { ms: 1500, tries: 50000 },
  /** One the diagram does itself (first draw, a big expansion): not to be waited for. */
  quick: { ms: 300, tries: 50000 },
};

interface Gap {
  x: number;
  y: number;
}
/** Room between two boxes side by side, and between two rows. */
const GAP: Gap = { x: 48, y: 48 };
/** Between folder blocks: wider, so a folder reads as one. */
const GROUP_GAP: Gap = { x: 96, y: 96 };
/** In a tree: between the blocks of one level, and between levels (room for the edges running down). */
const TREE_GAP: Gap = { x: 64, y: 64 };
const LEVEL_GAP = 112;
/** How wide a tree's levels may run, for each unit of its height. */
const TREE_ASPECT = 1.6;
/**
 * What hangs under one element in a tree is set out this many cells across for each down: edges
 * come in from above, and a block stacked down would have them run through its own top row.
 */
const UNDER_ASPECT = 2;

// ---- setting out in a square -------------------------------------------------------------------

interface Box {
  width: number;
  height: number;
}

/** What is round the boxes set out: a frame's padding, and its least width. */
interface Round {
  across: number;
  down: number;
  least: number;
}
const NOTHING_ROUND: Round = { across: 0, down: 0, least: 0 };

/**
 * The boxes set out no wider than `limit`, in their order, in rows: each row from the left, its boxes
 * level at the top, the next row under the tallest of them. A box that fits wholly within the row's
 * height under a shorter one (a card beside a tall frame) is tucked in there instead, and so the ones
 * after it, until one doesn't fit and starts the next row. With it, the next width that would set
 * them out otherwise.
 */
function packedWithin(boxes: readonly Box[], limit: number, gap: Gap) {
  // The line under which everything so far stands (its gap counted), from the left: each stretch, and how far down.
  let line = [{ from: 0, to: Infinity, down: 0 }];
  const at: { x: number; y: number }[] = [];
  let width = 0;
  let height = 0;
  let next = Infinity;
  // The row being filled: where it starts, where its next box goes, how far down its tallest box
  // reaches, and how far down anything tucked into it does.
  let row = { top: 0, along: 0, bottom: 0, under: 0 };
  let last: { x: number; y: number } | null = null;
  for (const box of boxes) {
    let spot: { x: number; y: number } | null = null;
    // In the row, level with the rest — until something is tucked under it.
    if (last === null || last.y === row.top) {
      if (row.along === 0 || row.along + box.width <= limit) spot = { x: row.along, y: row.top };
      else next = Math.min(next, row.along + box.width);
    }
    // Else tucked into the row: under a shorter box, clear, within the row's height, after the last as read.
    if (spot === null && last !== null)
      for (const { from: x } of line) {
        if (x + box.width > limit) continue;
        let clear = 0;
        for (const { from, to, down } of line) if (from < x + box.width + gap.x && to > x) clear = Math.max(clear, down);
        const y: number = x > last.x ? Math.max(clear, last.y) : clear;
        const after = y > last.y || (y === last.y && x > last.x);
        if (y > row.top && after && y + box.height <= row.bottom && (spot === null || y < spot.y)) spot = { x, y };
      }
    // Else it starts the next row, under all of this one.
    if (spot === null) {
      row = { top: row.under + gap.y, along: 0, bottom: 0, under: 0 };
      spot = { x: 0, y: row.top };
    }
    at.push(spot);
    last = spot;
    const under = spot.y + box.height;
    if (spot.y === row.top) {
      row.along = spot.x + box.width + gap.x;
      row.bottom = Math.max(row.bottom, under);
    }
    row.under = Math.max(row.under, under);
    width = Math.max(width, spot.x + box.width);
    height = Math.max(height, under);
    const from = spot.x;
    const to = from + box.width + gap.x;
    line = [
      ...line.flatMap((s) => [...(s.from < from ? [{ ...s, to: Math.min(s.to, from) }] : []), ...(s.to > to ? [{ ...s, from: Math.max(s.from, to) }] : [])]),
      { from, to, down: under + gap.y },
    ].sort((a, b) => a.from - b.from);
  }
  return { at, width, height, next };
}

/** How many columns a setting out may have for each row before wider ones are no longer tried. */
const WIDE_ENOUGH = 3;
/** How far from the squarest (as a ratio of columns to rows) a setting out may be to be a shape the search may try. */
const SHAPE_SLACK = 2.5;

type Rows = ReturnType<typeof packedWithin>;

/**
 * The ways boxes can be set out in their order (`packedWithin`), narrowest first, and which is the
 * squarest. Square is read both in cells — the whole's width in average boxes across against its
 * height in average boxes down — and in pixels, each off-square counted alike: four cards make 2 × 2
 * though cards are wide and low, and many wide frames come out about the screen's shape rather than
 * a band. Widths are tried from a little short of a square grid up, each the next that changes the
 * rows, until it has three columns for each row; only those within `SHAPE_SLACK` of the squarest are
 * kept. The search starts from the squarest and may step to a narrower or wider one.
 *
 * Given `under` (a block hanging under one element in a tree), the shape aimed at is `UNDER_ASPECT`
 * cells across for each down instead, read in cells alone.
 */
function shapesOf(boxes: readonly Box[], round: Round, gap: Gap, under = false): { shapes: Rows[]; widths: number[]; squarest: number } {
  const cellX = boxes.reduce((sum, b) => sum + b.width, 0) / Math.max(1, boxes.length) + gap.x;
  const cellY = boxes.reduce((sum, b) => sum + b.height, 0) / Math.max(1, boxes.length) + gap.y;
  // narrower than a square grid of them (in cells) is never the squarest: start a little short of it
  let limit = Math.max(0, ...boxes.map((b) => b.width), (Math.sqrt(boxes.length) / 2) * cellX - gap.x);
  const tried: { rows: Rows; limit: number; off: number; room: number }[] = [];
  for (;;) {
    const rows = packedWithin(boxes, limit, gap);
    const width = Math.max(round.least, rows.width + round.across);
    const height = rows.height + round.down;
    // in cells, by the boxes themselves: a frame's least width (its header) isn't columns of them
    const across = (rows.width + round.across + gap.x) / cellX;
    const down = (height + gap.y) / cellY;
    const off = under ? Math.log(across / down / UNDER_ASPECT) ** 2 : Math.log(across / down) ** 2 + Math.log(width / height) ** 2;
    tried.push({ rows, limit, off, room: width * height });
    if (rows.next === Infinity || across >= down * (under ? UNDER_ASPECT * 2 : WIDE_ENOUGH)) break;
    limit = rows.next;
  }
  const least = Math.min(...tried.map((t) => t.off));
  const kept = tried.filter((t) => t.off <= least + Math.log(SHAPE_SLACK) ** 2);
  const squarest = kept.reduce((best, t, i) => (t.off < kept[best]!.off - 1e-9 || (Math.abs(t.off - kept[best]!.off) <= 1e-9 && t.room < kept[best]!.room) ? i : best), 0);
  return { shapes: kept.map((t) => t.rows), widths: kept.map((t) => t.limit), squarest };
}

/** Boxes in rows no wider than `limit` (a box wider starts its own), each row centred under the widest. */
function centeredRows(boxes: readonly Box[], limit: number, gap: Gap): Rows {
  const rows: { items: number[]; width: number; height: number }[] = [];
  boxes.forEach((b, i) => {
    const row = rows.at(-1);
    if (row && row.width + gap.x + b.width <= limit) {
      row.items.push(i);
      row.width += gap.x + b.width;
      row.height = Math.max(row.height, b.height);
    } else rows.push({ items: [i], width: b.width, height: b.height });
  });
  const width = Math.max(0, ...rows.map((r) => r.width));
  const at: { x: number; y: number }[] = [];
  let y = 0;
  for (const row of rows) {
    let x = (width - row.width) / 2;
    for (const i of row.items) {
      at[i] = { x, y };
      x += boxes[i]!.width + gap.x;
    }
    y += row.height + gap.y;
  }
  return { at, width, height: Math.max(0, y - gap.y), next: Infinity };
}

/** Boxes one under another, each centred under the widest. */
function stacked(boxes: readonly Box[], gap: number): Rows {
  const width = Math.max(0, ...boxes.map((b) => b.width));
  let y = 0;
  const at = boxes.map((b) => {
    const spot = { x: (width - b.width) / 2, y };
    y += b.height + gap;
    return spot;
  });
  return { at, width, height: Math.max(0, y - gap), next: Infinity };
}

// ---- folder blocks -----------------------------------------------------------------------------

/** The id prefix of an invisible block (a folder's, or a tree's): never drawn, taken out of the result. */
const GROUP = "\u0000group:";
const isGroup = (id: string | null) => id !== null && id.startsWith(GROUP);

const dirOf = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
};

/**
 * Where an element sits in the folder tree, as the path of blocks it goes in: its file's folders (a
 * folder frame: its parent folder's), or one block for libraries and one for routes.
 */
function blockPathOf(e: DrawnElement): string[] {
  if (e.kind === "external") return ["\u0001libraries"];
  if (e.kind === "route") return ["\u0001routes"];
  const path = e.kind === "folder" ? e.id.slice(FOLDER_PREFIX.length) : e.id.split("#")[0]!;
  const dir = dirOf(path);
  return dir ? dir.split("/") : [];
}

/**
 * The graph with each container's elements put in blocks by the folder tree: every folder (below
 * what they all share) holding more than one of them — directly or in its subfolders — gets a block,
 * inside its parent folder's block. A folder holding just one subfolder adds no block of its own.
 */
function withFolderBlocks(graph: DrawnGraph): DrawnGraph {
  const regrouped = new Map<string, string>();
  const blocks: DrawnElement[] = [];
  for (const [parent, kids] of childrenOf(graph.elements)) {
    if (kids.length < 3) continue;
    const paths = kids.map(blockPathOf);
    // what they all share is the container itself
    let shared = 0;
    while (paths.every((p) => p.length > shared && p[shared] === paths[0]![shared])) shared++;
    /** Sets out the elements at `members` (indexes into kids), all below `depth` levels, under `into`. */
    const build = (members: number[], depth: number, into: string | null) => {
      const here: number[] = [];
      const below = new Map<string, number[]>();
      for (const i of members) {
        const step = paths[i]![depth];
        if (step === undefined) here.push(i);
        else below.set(step, [...(below.get(step) ?? []), i]);
      }
      for (const i of here) if (into !== null) regrouped.set(kids[i]!.id, into);
      for (const [step, list] of below) {
        // a folder with one element is that element; a folder with only one subfolder is that subfolder
        if (list.length < 2) {
          for (const i of list) if (into !== null) regrouped.set(kids[i]!.id, into);
          continue;
        }
        let depthTo = depth + 1;
        while (list.every((i) => paths[i]!.length > depthTo && paths[i]![depthTo] === paths[list[0]!]![depthTo])) depthTo++;
        // the whole container in one folder: no block round all of it
        if (list.length === kids.length) {
          build(list, depthTo, into);
          continue;
        }
        const name = paths[list[0]!]!.slice(depth, depthTo).join("/") || step;
        const id = `${GROUP}${into ?? parent ?? ""}\n${name}`;
        blocks.push({ id, kind: "folder", name, parent: into ?? parent });
        build(list, depthTo, id);
      }
    };
    build(
      kids.map((_, i) => i),
      shared,
      null,
    );
  }
  if (!blocks.length) return graph;
  return { elements: [...blocks, ...graph.elements.map((e) => (regrouped.has(e.id) ? { ...e, parent: regrouped.get(e.id)! } : e))], relations: graph.relations };
}

/** The placing without the invisible blocks: what they held, placed in the container round them. */
function withoutFolderBlocks(placed: readonly PlacedElement[], original: ReadonlyMap<string, DrawnElement>): PlacedElement[] {
  const blocks = new Map(placed.filter((p) => isGroup(p.element.id)).map((p) => [p.element.id, p]));
  if (!blocks.size) return [...placed];
  const out: PlacedElement[] = [];
  for (const p of placed) {
    if (blocks.has(p.element.id)) continue;
    let { x, y } = p;
    // blocks inside blocks: add up each one's place
    for (let b = blocks.get(p.element.parent ?? ""); b; b = blocks.get(b.element.parent ?? "")) {
      x += b.x;
      y += b.y;
    }
    out.push({ ...p, element: original.get(p.element.id) ?? p.element, x, y });
  }
  return out;
}

// ---- trees -------------------------------------------------------------------------------------

/** How the trees are set out: which containers are trees and levels, what each element hangs under. */
interface Trees {
  /** `stack`: a tree (its levels one under another); `rows`: a level (its blocks in centred rows). Others: a square. */
  mode: Map<string | null, "stack" | "rows">;
  /** A level below the first, and the level above it: its blocks go in the order of their parents there. */
  above: Map<string, string>;
  /** A level's block (or lone element), and the element above it hangs under. */
  under: Map<string, string>;
  /** Each tree's blocks (levels, parents' blocks, the unjoined), by the tree's container. */
  blocks: Map<string | null, string[]>;
  /** Each tree block, and its tree's container. */
  treeOf: Map<string, string | null>;
  /** Each tree's first level: its roots, ordered by the search. */
  firsts: Set<string>;
}

const noTrees = (): Trees => ({ mode: new Map(), above: new Map(), under: new Map(), blocks: new Map(), treeOf: new Map(), firsts: new Set() });

/** Fewer joined elements than this in a container: a square, not a tree. */
const TREE_FROM = 3;

/**
 * The graph with containers of files set out as trees: each container whose elements are files or
 * folders (no folder blocks among them, not a file's own declarations — `canBeTree`) with at least
 * `TREE_FROM` joined elements. Levels go down the relations, callers above what they call:
 *
 * - the roots: what nothing in the container calls (in a cycle nothing outside reaches: the one
 *   calling out most), the most joined first;
 * - each next level: what the level above calls and nothing has placed yet, each hanging under the
 *   one there that calls it most; what hangs under one element is a square block of its own;
 * - what is joined to nothing in the container: a square block at the bottom.
 *
 * Every block is a `GROUP` element: invisible, taken out of the result.
 */
function withTreeBlocks(graph: DrawnGraph, canBeTree: (container: string | null) => boolean): { graph: DrawnGraph; trees: Trees } {
  const flow = flowsOf(graph);
  const trees = noTrees();
  const reparented = new Map<string, string>();
  const levelBlocks: DrawnElement[] = [];
  const otherBlocks: DrawnElement[] = [];
  for (const [container, kids] of childrenOf(graph.elements)) {
    if (kids.length < TREE_FROM || kids.some((k) => isGroup(k.id)) || !canBeTree(container)) continue;
    const ids = kids.map((k) => k.id);
    const out = new Map(ids.map((a) => [a, ids.filter((b) => b !== a && flow(a, b) > 0)]));
    const inflow = new Map(ids.map((b) => [b, ids.reduce((sum, a) => sum + (a === b ? 0 : flow(a, b)), 0)]));
    const outflow = new Map(ids.map((a) => [a, ids.reduce((sum, b) => sum + (a === b ? 0 : flow(a, b)), 0)]));
    const degree = (id: string) => inflow.get(id)! + outflow.get(id)!;
    const joined = ids.filter((id) => degree(id) > 0);
    if (joined.length < TREE_FROM) continue;

    // levels, breadth first down the relations
    const level = new Map<string, number>();
    const parent = new Map<string, string>();
    const byDegree = (a: string, b: string) => degree(b) - degree(a) || a.localeCompare(b);
    let frontier = joined.filter((id) => inflow.get(id) === 0).sort(byDegree);
    let depth = 0;
    for (const id of frontier) level.set(id, 0);
    while (level.size < joined.length) {
      if (!frontier.length) {
        // a cycle nothing reaches: it starts from the one in it calling out most, among the roots
        const rest = joined.filter((id) => !level.has(id));
        const root = rest.sort((a, b) => outflow.get(b)! - inflow.get(b)! - (outflow.get(a)! - inflow.get(a)!) || byDegree(a, b))[0]!;
        level.set(root, 0);
        frontier = [root];
        depth = 0;
      }
      const next: string[] = [];
      for (const from of frontier)
        for (const to of out.get(from)!) {
          if (level.has(to)) continue;
          // under the one in the level above that calls it most
          const was = parent.get(to);
          if (was === undefined) next.push(to);
          if (was === undefined || flow(from, to) > flow(was, to)) parent.set(to, from);
        }
      depth++;
      for (const id of next) level.set(id, depth);
      frontier = next;
    }

    const prefix = `${GROUP}tree\n${container ?? ""}\n`;
    const levels: string[] = [];
    const levelId = (i: number) => {
      while (levels.length <= i) {
        const id = `${prefix}${levels.length}`;
        if (levels.length) trees.above.set(id, levels[levels.length - 1]!);
        levels.push(id);
        levelBlocks.push({ id, kind: "folder", name: `level ${levels.length}`, parent: container });
        trees.mode.set(id, "rows");
      }
      return levels[i]!;
    };
    const blocks: string[] = [];
    for (const id of joined) if (level.get(id) === 0) reparented.set(id, levelId(0));
    const hanging = new Map<string, string[]>();
    for (const id of joined) {
      const p = parent.get(id);
      if (p !== undefined && level.get(id)! > 0) hanging.set(p, [...(hanging.get(p) ?? []), id]);
    }
    for (const [p, list] of hanging) {
      const lvl = levelId(level.get(list[0]!)!);
      if (list.length === 1) {
        reparented.set(list[0]!, lvl);
        trees.under.set(list[0]!, p);
        continue;
      }
      const id = `${prefix}under\n${p}`;
      otherBlocks.push({ id, kind: "folder", name: "", parent: lvl });
      blocks.push(id);
      trees.under.set(id, p);
      for (const kid of list) reparented.set(kid, id);
    }
    const loose = ids.filter((id) => !level.has(id));
    if (loose.length) {
      const id = `${prefix}loose`;
      otherBlocks.push({ id, kind: "folder", name: "", parent: container });
      blocks.push(id);
      for (const kid of loose) reparented.set(kid, id);
    }
    trees.mode.set(container, "stack");
    trees.firsts.add(levels[0]!);
    trees.blocks.set(container, [...levels, ...blocks]);
    for (const b of [...levels, ...blocks]) trees.treeOf.set(b, container);
  }
  if (!levelBlocks.length) return { graph, trees };
  // the levels top to bottom, then what is joined to nothing: the stack goes as listed
  return {
    graph: { elements: [...levelBlocks, ...otherBlocks, ...graph.elements.map((e) => (reparented.has(e.id) ? { ...e, parent: reparented.get(e.id)! } : e))], relations: graph.relations },
    trees,
  };
}

// ---- placing a whole graph ---------------------------------------------------------------------

function childrenOf(elements: readonly DrawnElement[]): Map<string | null, DrawnElement[]> {
  const out = new Map<string | null, DrawnElement[]>();
  for (const e of elements) {
    const list = out.get(e.parent);
    if (list) list.push(e);
    else out.set(e.parent, [e]);
  }
  return out;
}

const NO_KIDS: readonly DrawnElement[] = [];

/** A container's elements set out, relative to its corner (each one's own contents relative to it). */
interface Block {
  width: number;
  height: number;
  placed: PlacedElement[];
}

const frameRound = (e: DrawnElement): Round => ({ across: PADDING.left + PADDING.right, down: PADDING.top + PADDING.bottom, least: frameWidthOf(e.name) });

/**
 * What sets out the graph inside `root` (the canvas when null): each container's elements in a
 * square, in the order `kidsOf` gives, each frame sized round what it holds — or, for a tree, its
 * levels one under another (`stacked`) and each level's blocks in centred rows (`centeredRows`), as
 * wide as makes the whole tree about `TREE_ASPECT`. A square container is set out at its squarest
 * width the first time, and at that width after (a swap moves boxes, not the shape) until `reshape`
 * steps it to a narrower or wider one. A container's packing is kept until `forget` is told it
 * changed. `root`'s own elements are placed from the corner of what they cover, shaped as inside it.
 */
function placerOf(root: DrawnElement | null, kidsOf: (parent: string | null) => readonly DrawnElement[], elementOf: (id: string) => DrawnElement | undefined, trees: Trees) {
  const rootId = root?.id ?? null;
  const cache = new Map<string | null, Block>();
  /** Each square container's width, and how many shapes off its squarest that is. */
  const widths = new Map<string | null, number>();
  const offs = new Map<string | null, number>();
  const roundOf = (parent: string | null): Round => {
    if (parent === rootId) return root ? frameRound(root) : NOTHING_ROUND;
    if (parent === null || isGroup(parent)) return NOTHING_ROUND;
    const e = elementOf(parent);
    return e ? frameRound(e) : NOTHING_ROUND;
  };
  const gapOf = (kids: readonly DrawnElement[]) => (kids.some((k) => isGroup(k.id)) ? GROUP_GAP : GAP);
  /** Whether a container is a block hanging under one element in a tree. */
  const isUnder = (parent: string | null) => parent !== null && isGroup(parent) && trees.under.has(parent);
  /** How wide a tree's levels may run: about `TREE_ASPECT` times as wide as the tree is tall. */
  const rowLimit = (level: string) => {
    const tree = trees.treeOf.get(level) ?? null;
    let area = 0;
    let widest = 0;
    for (const l of kidsOf(tree))
      if (trees.mode.get(l.id) === "rows")
        for (const k of kidsOf(l.id)) {
          const s = sizeOf(k);
          area += (s.width + TREE_GAP.x) * (s.height + TREE_GAP.y);
          widest = Math.max(widest, s.width);
        }
    return Math.max(widest, Math.sqrt(area * TREE_ASPECT));
  };
  const block = (parent: string | null): Block => {
    const kept = cache.get(parent);
    if (kept) return kept;
    const kids = kidsOf(parent);
    const sized = kids.map(sizeOf);
    const mode = trees.mode.get(parent);
    let rows: Rows;
    if (mode === "stack") rows = stacked(sized, LEVEL_GAP);
    else if (mode === "rows") rows = centeredRows(sized, rowLimit(parent!), TREE_GAP);
    else {
      const gap = gapOf(kids);
      const width = widths.get(parent);
      if (width === undefined) {
        const { shapes, widths: ws, squarest } = shapesOf(sized, roundOf(parent), gap, isUnder(parent));
        rows = shapes[squarest]!;
        widths.set(parent, ws[squarest]!);
        offs.set(parent, 0);
      } else rows = packedWithin(sized, width, gap);
    }
    // a frame's elements stand inside its padding; a block's and the root's from its corner
    const corner = parent === rootId || isGroup(parent) ? { left: 0, top: 0 } : PADDING;
    const placed: PlacedElement[] = [];
    kids.forEach((element, i) => {
      const { width: w, height, holds, inside } = sized[i]!;
      const spot = rows.at[i]!;
      placed.push({ element, holds, x: corner.left + spot.x, y: corner.top + spot.y, width: w, height });
      for (const p of inside) placed.push(p);
    });
    const out = { width: rows.width, height: rows.height, placed };
    cache.set(parent, out);
    return out;
  };
  const sizeOf = (e: DrawnElement) => {
    if (!kidsOf(e.id).length) return { width: cardWidthOf(e), height: CARD_HEIGHT, holds: false, inside: [] as PlacedElement[] };
    const round = roundOf(e.id);
    const held = block(e.id);
    return { width: Math.max(round.least, held.width + round.across), height: Math.max(isGroup(e.id) ? 0 : CARD_HEIGHT, held.height + round.down), holds: true, inside: held.placed };
  };
  type Forgotten = [string | null, Block | undefined][];
  return {
    place: () => block(rootId).placed,
    /** How many shapes off their squarest the containers are, together. */
    shapeCost: () => [...offs.values()].reduce((sum, o) => sum + Math.abs(o), 0),
    /** Steps a square container to the next narrower (-1) or wider (+1) shape; how to take it back, or null when there's none. */
    reshape(parent: string | null, step: number): (() => void) | null {
      if (trees.mode.has(parent)) return null;
      const kids = kidsOf(parent);
      const { widths: ws, squarest } = shapesOf(kids.map(sizeOf), roundOf(parent), gapOf(kids), isUnder(parent));
      const was = widths.get(parent);
      const wasOff = offs.get(parent) ?? 0;
      let at = 0;
      for (let i = 0; i < ws.length; i++) if (was !== undefined && ws[i]! <= was + 1e-6) at = i;
      const to = at + step;
      if (was === undefined || to < 0 || to >= ws.length) return null;
      widths.set(parent, ws[to]!);
      offs.set(parent, to - squarest);
      return () => {
        widths.set(parent, was);
        offs.set(parent, wasOff);
      };
    },
    /**
     * Forgets the packing of `container` and those round it — all of a tree it is in or inside: a
     * level's order and width hang on the others — and what it forgot, to `restore` if undone.
     */
    forget(container: string | null, parentOf: (id: string) => string | null): Forgotten {
      const forgotten: Forgotten = [];
      const drop = (at: string | null) => {
        forgotten.push([at, cache.get(at)]);
        cache.delete(at);
      };
      for (let at: string | null = container; ; at = parentOf(at)) {
        drop(at);
        const tree = at === null ? undefined : trees.treeOf.get(at);
        if (tree !== undefined) for (const b of trees.blocks.get(tree) ?? []) if (b !== at) drop(b);
        if (at === rootId || at === null) break;
      }
      return forgotten;
    },
    restore(forgotten: Forgotten) {
      for (const [at, b] of forgotten.toReversed()) {
        if (b) cache.set(at, b);
        else cache.delete(at);
      }
    },
    /** All it keeps, to go back to (`load`). */
    save: () => ({ cache: new Map(cache), widths: new Map(widths), offs: new Map(offs) }),
    load(saved: { cache: Map<string | null, Block>; widths: Map<string | null, number>; offs: Map<string | null, number> }) {
      cache.clear();
      widths.clear();
      offs.clear();
      for (const [k, v] of saved.cache) cache.set(k, v);
      for (const [k, v] of saved.widths) widths.set(k, v);
      for (const [k, v] of saved.offs) offs.set(k, v);
    },
  };
}

// ---- reading how the edges tangle --------------------------------------------------------------

/** How the edges of a placing tangle. */
export interface Tangle {
  /** Edges running through a card or frame that is neither of their ends, nor round one. */
  through: number;
  /** Pairs of edges that cross. */
  crossings: number;
  /** All edges' lengths together. */
  length: number;
}

/** What each is worth: an edge through a card is worse than a crossing, a crossing than a long way round. */
const THROUGH = 10;
const CROSSING = 8;
const LENGTH = 1 / 1000;
/** A container set out one shape off its squarest: less than a crossing it clears, more than most edges it only shortens. */
const SHAPE = 1.5;
const weightOf = ({ through, crossings, length }: Tangle) => through * THROUGH + crossings * CROSSING + length * LENGTH;

/** Which side of the line a → b the point p is on. */
const sideOf = (ax: number, ay: number, bx: number, by: number, px: number, py: number) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);

/**
 * What reads a placing of this graph for how its edges tangle. What doesn't change between placings
 * — the pairs joined, who holds whom — is worked out once. Invisible blocks aren't drawn: nothing
 * runs through them.
 */
function tangleReaderOf(graph: DrawnGraph) {
  const count = graph.elements.length;
  const index = new Map(graph.elements.map((e, i) => [e.id, i]));
  const parentOf = graph.elements.map((e) => (e.parent === null ? -1 : (index.get(e.parent) ?? -1)));
  const drawn = graph.elements.map((e) => !isGroup(e.id));
  /** Whether `outer` is drawn round `inner`, at any depth. */
  const isRound = (outer: number, inner: number) => {
    for (let at = parentOf[inner]!; at >= 0; at = parentOf[at]!) if (at === outer) return true;
    return false;
  };
  // each pair joined once, however many relations join it; none between a frame and what it holds
  const seen = new Set<string>();
  const from: number[] = [];
  const to: number[] = [];
  for (const r of graph.relations) {
    const a = index.get(r.source);
    const b = index.get(r.target);
    if (a === undefined || b === undefined || a === b || isRound(a, b) || isRound(b, a)) continue;
    const key = a < b ? `${a} ${b}` : `${b} ${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    from.push(a);
    to.push(b);
  }
  const edges = from.length;
  /** Whether an edge may run through `at`: not one of its ends, nor round one, nor held by one (it starts at their borders). */
  const inTheWay = (edge: number, at: number) => {
    const a = from[edge]!;
    const b = to[edge]!;
    return drawn[at] && at !== a && at !== b && !isRound(at, a) && !isRound(at, b) && !isRound(a, at) && !isRound(b, at);
  };

  const left = new Float64Array(count);
  const top = new Float64Array(count);
  const right = new Float64Array(count);
  const bottom = new Float64Array(count);
  const midX = new Float64Array(count);
  const midY = new Float64Array(count);

  /** Whether the segment a → b runs through the box of `at` (Liang–Barsky clipping). */
  const runsThrough = (ax: number, ay: number, bx: number, by: number, at: number) => {
    let enter = 0;
    let leave = 1;
    const dx = bx - ax;
    const dy = by - ay;
    const cuts = [
      [-dx, ax - left[at]!],
      [dx, right[at]! - ax],
      [-dy, ay - top[at]!],
      [dy, bottom[at]! - ay],
    ] as const;
    for (const [step, room] of cuts) {
      if (step === 0) {
        if (room < 0) return false;
        continue;
      }
      const reach = room / step;
      if (step < 0) enter = Math.max(enter, reach);
      else leave = Math.min(leave, reach);
      if (enter >= leave) return false;
    }
    return true;
  };

  return {
    joined: edges > 0,
    read(placed: readonly PlacedElement[]): Tangle {
      // a container comes before what it holds, each relative to it
      for (const { element, x, y, width, height } of placed) {
        const at = index.get(element.id);
        if (at === undefined) continue;
        const round = parentOf[at]!;
        left[at] = x + (round < 0 ? 0 : left[round]!);
        top[at] = y + (round < 0 ? 0 : top[round]!);
        right[at] = left[at]! + width;
        bottom[at] = top[at]! + height;
        midX[at] = (left[at]! + right[at]!) / 2;
        midY[at] = (top[at]! + bottom[at]!) / 2;
      }
      let through = 0;
      let crossings = 0;
      let length = 0;
      for (let one = 0; one < edges; one++) {
        const a = from[one]!;
        const b = to[one]!;
        const ax = midX[a]!;
        const ay = midY[a]!;
        const bx = midX[b]!;
        const by = midY[b]!;
        length += Math.hypot(bx - ax, by - ay);
        const x0 = Math.min(ax, bx);
        const x1 = Math.max(ax, bx);
        const y0 = Math.min(ay, by);
        const y1 = Math.max(ay, by);
        for (let at = 0; at < count; at++) {
          // the edge's bounding box first: most boxes are nowhere near it
          if (right[at]! < x0 || left[at]! > x1 || bottom[at]! < y0 || top[at]! > y1) continue;
          if (runsThrough(ax, ay, bx, by, at) && inTheWay(one, at)) through++;
        }
        for (let other = one + 1; other < edges; other++) {
          const c = from[other]!;
          const d = to[other]!;
          // two edges of one card meet at it; they don't cross
          if (c === a || c === b || d === a || d === b) continue;
          const cx = midX[c]!;
          const cy = midY[c]!;
          const dx = midX[d]!;
          const dy = midY[d]!;
          if (Math.max(cx, dx) < x0 || Math.min(cx, dx) > x1 || Math.max(cy, dy) < y0 || Math.min(cy, dy) > y1) continue;
          if (sideOf(ax, ay, bx, by, cx, cy) * sideOf(ax, ay, bx, by, dx, dy) < 0 && sideOf(cx, cy, dx, dy, ax, ay) * sideOf(cx, cy, dx, dy, bx, by) < 0) crossings++;
        }
      }
      return { through, crossings, length };
    },
  };
}

/** How the edges of a placing tangle (for tests). */
export const tangleOf = (graph: DrawnGraph, placed: readonly PlacedElement[]): Tangle => tangleReaderOf(graph).read(placed);

// ---- the starting order ------------------------------------------------------------------------

/**
 * How much joins two elements of one container: a relation counts for the two elements of the
 * container its ends are, or are drawn inside.
 */
function joinsOf(graph: DrawnGraph) {
  return pairsOf(graph, false);
}

/** How many relations run from one element of a container to another (what they hold counted), one way. */
function flowsOf(graph: DrawnGraph) {
  return pairsOf(graph, true);
}

function pairsOf(graph: DrawnGraph, directed: boolean) {
  const parentOf = new Map(graph.elements.map((e) => [e.id, e.parent]));
  /** An element and each container round it, outermost first. */
  const wayTo = (id: string) => {
    const way = [id];
    for (let at = parentOf.get(id) ?? null; at !== null; at = parentOf.get(at) ?? null) way.push(at);
    return way.reverse();
  };
  const pairs = new Map<string, number>();
  const keyOf = (one: string, other: string) => (directed || one < other ? `${one}\n${other}` : `${other}\n${one}`);
  for (const { source, target } of graph.relations) {
    if (!parentOf.has(source) || !parentOf.has(target)) continue;
    const a = wayTo(source);
    const b = wayTo(target);
    // where their ways part, they are two elements of one container
    let at = 0;
    while (at < a.length && at < b.length && a[at] === b[at]) at++;
    const one = a[at];
    const other = b[at];
    if (one === undefined || other === undefined) continue;
    const key = keyOf(one, other);
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  return (one: string, other: string) => pairs.get(keyOf(one, other)) ?? 0;
}

const KIND_ORDER: DrawnKind[] = ["folder", "route", "module", "component", "hook", "serverAction", "function", "type", "external"];
const kindRank = (k: DrawnKind) => KIND_ORDER.indexOf(k);
/** Frames first, then by kind, then by name (sibling folders' blocks side by side): the order among equally joined elements. */
const inPlacingOrder = (kids: readonly DrawnElement[], holds: (id: string) => boolean) =>
  [...kids].sort((a, b) => Number(holds(b.id)) - Number(holds(a.id)) || kindRank(a.kind) - kindRank(b.kind) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

/** A container's elements with what is joined side by side: the most joined first, then each time the one joined most to those set out. */
function sideBySide(kids: readonly DrawnElement[], joins: (a: string, b: string) => number, holds: (id: string) => boolean): DrawnElement[] {
  const waiting = inPlacingOrder(kids, holds);
  const inAll = new Map(waiting.map(({ id }) => [id, waiting.reduce((sum, o) => sum + joins(id, o.id), 0)]));
  const toThose = new Map(waiting.map(({ id }) => [id, 0]));
  const out: DrawnElement[] = [];
  while (waiting.length) {
    let pick = 0;
    let most = -1;
    let mostInAll = -1;
    waiting.forEach(({ id }, at) => {
      const near = toThose.get(id)!;
      const all = inAll.get(id)!;
      if (near > most || (near === most && all > mostInAll)) [pick, most, mostInAll] = [at, near, all];
    });
    const [picked] = waiting.splice(pick, 1);
    out.push(picked!);
    for (const { id } of waiting) toThose.set(id, toThose.get(id)! + joins(id, picked!.id));
  }
  return out;
}

// ---- the search --------------------------------------------------------------------------------

/** What is drawn inside a frame, all the way down, and the relations among it. */
function insideOf(graph: DrawnGraph, frame: string): DrawnGraph {
  const kids = childrenOf(graph.elements);
  const inside = new Set<string>();
  const gather = (parent: string) => {
    for (const { id } of kids.get(parent) ?? NO_KIDS) {
      inside.add(id);
      gather(id);
    }
  };
  gather(frame);
  return {
    elements: graph.elements.filter((e) => inside.has(e.id)),
    relations: graph.relations.filter((r) => inside.has(r.source) && inside.has(r.target)),
  };
}

/**
 * A container's elements ordered as a force-directed embedding of them sets them out (joined ones
 * pull, all push apart; started from `start`'s grid), read into the grid: by height into rows of
 * `columns`, each row from the left. Null for too few to be worth it.
 */
function forceOrder(start: readonly DrawnElement[], joins: (a: string, b: string) => number, columns: number): DrawnElement[] | null {
  const n = start.length;
  if (n < 4) return null;
  const w: number[][] = start.map((a) => start.map((b) => (a === b ? 0 : joins(a.id, b.id))));
  if (!w.some((row) => row.some((v) => v > 0))) return null;
  // the grid it starts from, a cell a unit (cells are about twice as wide as tall)
  const x = start.map((_, i) => (i % columns) * 2);
  const y = start.map((_, i) => Math.floor(i / columns));
  const rounds = Math.max(40, Math.min(300, Math.floor(4e6 / (n * n))));
  for (let r = 0; r < rounds; r++) {
    const heat = 1.5 * (1 - r / rounds) + 0.05;
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const ex = x[i]! - x[j]!;
        const ey = y[i]! - y[j]!;
        const d2 = Math.max(ex * ex + ey * ey, 1e-4);
        const d = Math.sqrt(d2);
        // push: 1/d; pull: d² for each relation between them
        const f = 1 / d2 - (w[i]![j]! * d) / 4;
        dx[i] += ex * f;
        dy[i] += ey * f;
        dx[j] -= ex * f;
        dy[j] -= ey * f;
      }
    for (let i = 0; i < n; i++) {
      const len = Math.hypot(dx[i]!, dy[i]!);
      if (len > 0) {
        const step = Math.min(len, heat);
        x[i] += (dx[i]! / len) * step;
        y[i] += (dy[i]! / len) * step;
      }
    }
  }
  const byHeight = start.map((e, i) => ({ e, x: x[i]!, y: y[i]! })).sort((a, b) => a.y - b.y);
  const out: DrawnElement[] = [];
  for (let at = 0; at < n; at += columns) out.push(...byHeight.slice(at, at + columns).sort((a, b) => a.x - b.x).map((p) => p.e));
  return out;
}

/** A small seeded random source (mulberry32): the same graph, the same shakes. */
function randomOf(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Places what is drawn inside `within` — the whole diagram, or one frame's elements with all they
 * hold — each container's elements in the order (and shape) that tangles the edges least, a
 * folder's elements together; in `tree` mode, containers of files tree-like (see the top of this
 * file). A frame is untangled for the relations among what it holds; those leaving it aren't read.
 */
export function squareLayout(graph: DrawnGraph, within: string | null = null, effort: LayoutEffort = "thorough", mode: LayoutMode = "square"): PlacedElement[] {
  const original = new Map(graph.elements.map((e) => [e.id, e]));
  const folded = withFolderBlocks(within === null ? graph : insideOf(graph, within));
  // a tree grows in the canvas, a folder frame or a folder block — not among a file's declarations
  const canBeTree = (c: string | null) => c === null || isGroup(c) || original.get(c)?.kind === "folder";
  const { graph: read, trees } = mode === "tree" ? withTreeBlocks(folded, canBeTree) : { graph: folded, trees: noTrees() };
  const byId = new Map(read.elements.map((e) => [e.id, e]));
  const root = within === null ? null : (original.get(within) ?? null);
  const children = childrenOf(read.elements);
  const parentOf = new Map(read.elements.map((e) => [e.id, e.parent]));
  const up = (id: string) => parentOf.get(id) ?? null;
  const joins = joinsOf(read);
  const holds = (id: string) => children.has(id);
  // a tree's levels stay top to bottom, as listed; every other container starts with what is joined side by side
  const order = new Map([...children].map(([parent, kids]) => [parent, trees.mode.get(parent) === "stack" ? kids : sideBySide(kids, joins, holds)]));
  /** A container's elements in order; a tree's level below the first: its blocks in the order of what they hang under. */
  const kidsOf = (parent: string | null): readonly DrawnElement[] => {
    const list = order.get(parent) ?? NO_KIDS;
    const above = parent === null ? undefined : trees.above.get(parent);
    if (above === undefined) return list;
    const rank = new Map<string, number>();
    for (const k of kidsOf(above)) for (const e of isGroup(k.id) ? kidsOf(k.id) : [k]) rank.set(e.id, rank.size);
    const rankOf = (e: DrawnElement) => rank.get(trees.under.get(e.id) ?? "") ?? 0;
    return [...list].sort((a, b) => rankOf(a) - rankOf(b));
  };
  const placer = placerOf(root, kidsOf, (id) => byId.get(id), trees);
  const reader = tangleReaderOf(read);
  const weigh = (placed: readonly PlacedElement[]) => weightOf(reader.read(placed)) + placer.shapeCost() * SHAPE;

  let best = placer.place();
  if (!reader.joined) return withoutFolderBlocks(best, original);
  let least = weigh(best);
  const limit = LIMITS[effort];
  const until = performance.now() + limit.ms;
  let tries = 0;
  const outOfTime = () => ++tries > limit.tries || performance.now() > until;

  /** Tries a change to `container`: kept if the placing tangles less, else taken back with `undo`. */
  const attempt = (container: string | null, undo: () => void) => {
    const forgotten = placer.forget(container, up);
    const placed = placer.place();
    const weight = weigh(placed);
    if (weight < least - 1e-9) {
      best = placed;
      least = weight;
      return true;
    }
    undo();
    placer.restore(forgotten);
    return false;
  };

  const depthOf = (id: string | null) => {
    let depth = 0;
    for (let at = id; at !== null && at !== within; at = up(at)) depth++;
    return depth;
  };
  // Outer containers first: their order decides the most. A tree's own order is its levels', and a
  // level below the first follows the one above: neither is searched, the first level and what
  // hangs under each element are.
  const searched = (parent: string | null) => !trees.mode.has(parent) || (parent !== null && trees.firsts.has(parent));
  const containers = [...order].filter(([parent, kids]) => kids.length > 1 && searched(parent)).sort((a, b) => depthOf(a[0]) - depthOf(b[0]));

  // A start from a force-directed embedding, for each container where it tangles less.
  for (const [parent, kids] of containers) {
    if (outOfTime()) break;
    const placedKids = best.filter((p) => p.element.parent === parent);
    const top = Math.min(...placedKids.map((p) => p.y));
    const columns = Math.max(1, placedKids.filter((p) => p.y === top).length);
    const forced = forceOrder(kids, joins, columns);
    if (!forced) continue;
    const was = [...kids];
    kids.splice(0, kids.length, ...forced);
    attempt(parent, () => kids.splice(0, kids.length, ...was));
  }

  // Elements a relation leaves from or arrives at, or holding one that does: swapping two others changes little.
  const touched = new Set<string>();
  for (const r of read.relations) for (const end of [r.source, r.target]) for (let at: string | null = end; at !== null; at = up(at)) touched.add(at);

  /** Swaps and shape steps, each kept when it tangles less, until none does or time is up; false when out of time. */
  const climb = (): boolean => {
    for (let better = true; better; ) {
      better = false;
      for (const [parent, kids] of containers) {
        for (const step of [1, -1]) {
          if (outOfTime()) return false;
          const undo = placer.reshape(parent, step);
          if (undo && attempt(parent, undo)) better = true;
        }
        for (let one = 0; one < kids.length - 1; one++)
          for (let other = one + 1; other < kids.length; other++) {
            if (!touched.has(kids[one]!.id) && !touched.has(kids[other]!.id)) continue;
            if (outOfTime()) return false;
            [kids[one], kids[other]] = [kids[other]!, kids[one]!];
            if (attempt(parent, () => ([kids[one], kids[other]] = [kids[other]!, kids[one]!]))) better = true;
          }
      }
    }
    return true;
  };

  // Iterated local search: climb; then, while there's time, shake one container a little and climb
  // again, going back to the best placing when that ends up no better.
  const random = randomOf(read.elements.length * 7919 + read.relations.length);
  const saveAll = () => ({ placer: placer.save(), orders: new Map([...order].map(([k, v]) => [k, [...v]])), best, least });
  // nothing through a card, nothing crossing: only lengths left to shorten, not worth shaking for
  const untangled = () => {
    const t = reader.read(best);
    return t.through === 0 && t.crossings === 0;
  };
  for (let more = climb(); more && containers.length && !untangled(); ) {
    const saved = saveAll();
    const [parent, kids] = containers[Math.floor(random() * containers.length)]!;
    for (let k = 0; k < 2; k++) {
      const i = Math.floor(random() * kids.length);
      const j = Math.floor(random() * kids.length);
      [kids[i], kids[j]] = [kids[j]!, kids[i]!];
    }
    placer.forget(parent, up);
    // the shaken placing is the one to climb from, worse or not
    best = placer.place();
    least = weigh(best);
    more = climb();
    if (least < saved.least - 1e-9) continue;
    placer.load(saved.placer);
    for (const [k, v] of saved.orders) order.get(k)!.splice(0, v.length, ...v);
    best = saved.best;
    least = saved.least;
  }
  return withoutFolderBlocks(best, original);
}

/** The whole diagram, placed by relations. */
export async function layoutAll(graph: DrawnGraph, effort: LayoutEffort = "quick", mode: LayoutMode = "square"): Promise<PlacedElement[]> {
  return squareLayout(graph, null, effort, mode);
}

/** What one container holds, placed as if nothing else were drawn: its own elements from the corner of what they cover. */
export async function layoutWithin(graph: DrawnGraph, id: string, mode: LayoutMode = "square"): Promise<PlacedElement[]> {
  return squareLayout(graph, id, "thorough", mode);
}
