/**
 * Diagram palettes: the colours of the canvas, cards, frames, node kinds, relations, diff marks and
 * selection. `paper` is the theme's own (theme.ts reads it); the others override the same CSS
 * variables under `html[data-palette="…"]` (and `html.dark[data-palette="…"]`), set by
 * `setDiagramPalette` and stored as `rae.palette`. The shell's neutrals don't change.
 *
 * The overrides go in a plain <style> of their own (`installDiagramPalettes`), not the theme's
 * `globalCss`: Chakra puts that in `@layer base`, before the layer holding its token variables, and
 * a later layer wins whatever the selectors — the overrides never applied. Unlayered CSS beats them all.
 *
 * Every palette is checked against WCAG 2.x in both modes: text ≥ 4.5 : 1 (card names, kind
 * captions, frame titles), and ≥ 3 : 1 for what isn't text (card and frame outlines on the canvas,
 * kind icons on cards, edges on the canvas and on frames, the selection outline, diff marks).
 * Blue (hue 262) stays the selection's in every palette.
 */
import { useSyncExternalStore } from "react";

const ok = (l: number, c: number, h: number, a?: number) => `oklch(${l} ${c} ${h}${a != null ? ` / ${a}` : ""})`;

/** A light and a dark value. */
export type Pair = readonly [light: string, dark: string];

export type KindKey = "component" | "hook" | "serverAction" | "function" | "type" | "route" | "external";
export const KIND_KEYS: readonly KindKey[] = ["component", "hook", "serverAction", "function", "type", "route", "external"];
/** Today's kind hues (no kind in 240–280: that's selection blue). */
export const KIND_HUES: Record<KindKey, number> = { component: 210, hook: 300, serverAction: 55, function: 175, type: 140, route: 355, external: 90 };

/** Relation → the kind whose hue it takes (`imports` is neutral). */
const RELATION_KIND = { renders: "component", usesHook: "hook", invokes: "function", invokesAction: "serverAction", usesType: "type", navigates: "route" } as const satisfies Record<string, KindKey>;

interface PaletteSpec {
  canvas: Pair;
  dot: Pair;
  frame: Pair;
  card: Pair;
  cardSelected: Pair;
  /** Card and frame outline (B: frames only; cards take their kind's line). */
  border: Pair;
  selection: Pair;
  related: Pair;
  ring: Pair;
  hues: Record<KindKey, number>;
  /** Kind icon and stroke. */
  solid: (h: number) => Pair;
  /** Kind caption text. */
  fg: (h: number) => Pair;
  /** Kind tint (B: the card's fill) and line (hover outline; B: the card's outline). */
  subtle: (h: number) => Pair;
  muted: (h: number) => Pair;
  relation: (h: number) => Pair;
  imports: Pair;
  diff: { added: Pair; changed: Pair; removed: Pair };
}

/** Kind tint and line as the theme has always had them. */
const subtleOf = (h: number): Pair => [ok(0.96, 0.025, h), ok(0.3, 0.05, h)];
const mutedOf = (h: number): Pair => [ok(0.8, 0.06, h), ok(0.45, 0.07, h)];
const BLUE = { selection: [ok(0.52, 0.21, 262), ok(0.72, 0.16, 262)], related: [ok(0.62, 0.14, 262), ok(0.58, 0.11, 262)], ring: [ok(0.52, 0.21, 262, 0.18), ok(0.72, 0.16, 262, 0.22)] } as const;
const DIFF = { added: [ok(0.52, 0.15, 150), ok(0.74, 0.16, 150)], changed: [ok(0.58, 0.14, 70), ok(0.82, 0.15, 85)], removed: [ok(0.53, 0.2, 25), ok(0.7, 0.17, 25)] } as const;

/** A · Paper: warm neutrals, kind colour on icons, captions and edges; every pair over its threshold. */
const paper: PaletteSpec = {
  canvas: ["#F3F2EE", "#121316"],
  dot: ["#C4BFB4", "#2C2E34"],
  frame: ["#FAF9F6", "#18191D"],
  card: ["#FFFFFF", "#1F2126"],
  cardSelected: ["#FFFFFF", "#262931"],
  border: ["#8E8A81", "#6C7079"],
  ...BLUE,
  hues: KIND_HUES,
  solid: (h) => [ok(0.5, 0.15, h), ok(0.78, 0.13, h)],
  fg: (h) => [ok(0.42, 0.12, h), ok(0.85, 0.1, h)],
  subtle: subtleOf,
  muted: mutedOf,
  relation: (h) => [ok(0.52, 0.15, h), ok(0.72, 0.13, h)],
  imports: ["#4A4844", "#A9ACB3"],
  diff: DIFF,
};

/** B · Tinted: each card a pale tint of its kind with an outline in it. */
const tinted: PaletteSpec = {
  canvas: ["#F7F7F5", "#111214"],
  dot: ["#CDCCC7", "#2A2B30"],
  frame: ["#FFFFFF", "#17181B"],
  card: ["#FFFFFF", "#1E1F23"],
  cardSelected: ["#FFFFFF", "#25272C"],
  border: ["#8B8A85", "#686B73"],
  ...BLUE,
  hues: KIND_HUES,
  solid: (h) => [ok(0.5, 0.15, h), ok(0.8, 0.12, h)],
  fg: (h) => [ok(0.4, 0.12, h), ok(0.87, 0.08, h)],
  subtle: (h) => [ok(0.965, 0.03, h), ok(0.27, 0.04, h)],
  muted: (h) => [ok(0.6, 0.12, h), ok(0.62, 0.1, h)],
  relation: (h) => [ok(0.52, 0.15, h), ok(0.72, 0.13, h)],
  imports: ["#46464A", "#A9ABB2"],
  diff: DIFF,
};

/** C · High contrast: cool ink on white, text at AAA, kind hues moved off the diff colours. */
const ink: PaletteSpec = {
  canvas: ["#FFFFFF", "#0B0C0F"],
  dot: ["#C9CDD4", "#2A2D33"],
  frame: ["#F3F4F6", "#121418"],
  card: ["#FFFFFF", "#16181C"],
  cardSelected: ["#FFFFFF", "#1D2025"],
  border: ["#5D626C", "#959BA6"],
  selection: [ok(0.5, 0.22, 262), ok(0.76, 0.15, 262)],
  related: [ok(0.6, 0.15, 262), ok(0.62, 0.12, 262)],
  ring: [ok(0.5, 0.22, 262, 0.2), ok(0.76, 0.15, 262, 0.24)],
  hues: { component: 205, hook: 315, serverAction: 45, function: 180, type: 105, route: 340, external: 70 },
  solid: (h) => [ok(0.46, 0.16, h), ok(0.82, 0.14, h)],
  fg: (h) => [ok(0.37, 0.12, h), ok(0.9, 0.08, h)],
  subtle: subtleOf,
  muted: (h) => [ok(0.62, 0.1, h), ok(0.6, 0.09, h)],
  relation: (h) => [ok(0.46, 0.16, h), ok(0.8, 0.14, h)],
  imports: ["#2B2E34", "#C9CDD4"],
  diff: { added: [ok(0.5, 0.15, 150), ok(0.78, 0.17, 150)], changed: [ok(0.55, 0.14, 70), ok(0.85, 0.15, 85)], removed: [ok(0.5, 0.2, 25), ok(0.74, 0.17, 25)] },
};

/**
 * D · Graphite: nodes are solid slate blocks — dark slate with light text on a light canvas, mid
 * slate on a dark one (`GRAPHITE_CARDS`, set on the cards only, so tooltips and the sidebar keep
 * their colours) — in light file frames; edges carry only a hint of their hue.
 */
const graphite: PaletteSpec = {
  canvas: ["#E9ECF0", "#16191E"],
  dot: ["#BFC5CD", "#2E333B"],
  frame: ["#F3F5F7", "#1D2127"],
  card: ["#FFFFFF", "#282D35"],
  cardSelected: ["#FFFFFF", "#2F353E"],
  // frames' outline; cards draw their own (GRAPHITE_CARDS)
  border: ["#78808B", "#666E7A"],
  ...BLUE,
  hues: KIND_HUES,
  solid: (h) => [ok(0.5, 0.09, h), ok(0.86, 0.07, h)],
  fg: (h) => [ok(0.42, 0.12, h), ok(0.85, 0.1, h)],
  subtle: subtleOf,
  muted: (h) => [ok(0.72, 0.04, h), ok(0.5, 0.04, h)],
  relation: (h) => [ok(0.5, 0.05, h), ok(0.74, 0.05, h)],
  imports: ["#555C66", "#A6ADB7"],
  diff: { added: DIFF.added, changed: DIFF.changed, removed: [DIFF.removed[0], ok(0.72, 0.17, 25)] },
};

/** Graphite's cards, by mode: their fill, outline and everything drawn on them. */
const GRAPHITE_CARDS = (side: 0 | 1): Record<string, string> => {
  const light = side === 0;
  const text = light ? { fg: "#F3F5F8", muted: "#D5DAE1", subtle: "#C2C8D1" } : { fg: "#F1F3F6", muted: "#D2D7DE", subtle: "#B9C0CA" };
  const out: Record<string, string> = {
    [cssVar("card.bg")]: light ? "#323943" : "#3A414C",
    [cssVar("card.bgSelected")]: light ? "#3A424D" : "#434B57",
    // a type card's blueprint ground
    [cssVar("bg.subtle")]: light ? "#3A414C" : "#353C46",
    [cssVar("bg.muted")]: light ? "#414955" : "#454D59",
    [cssVar("bg.emphasized")]: light ? "#4A5260" : "#4F5865",
    [cssVar("fg")]: text.fg,
    [cssVar("fg.muted")]: text.muted,
    [cssVar("fg.subtle")]: text.subtle,
    // the canvas's own aliases (resolved on .rae-canvas) follow
    "--fg": text.fg,
    "--fg-muted": text.muted,
    "--fg-subtle": text.subtle,
    "--line": light ? "#1F242B" : "#8A929E",
    [cssVar("border.emphasized")]: light ? "#555D6A" : "#5A6370",
    // the canvas sets its text colour once; a card's must follow its own fg
    color: text.fg,
  };
  for (const k of KIND_KEYS) {
    const h = graphite.hues[k];
    out[cssVar(`kind.${k}.solid`)] = light ? ok(0.84, 0.08, h) : ok(0.86, 0.07, h);
    out[cssVar(`kind.${k}.fg`)] = text.subtle;
    out[cssVar(`kind.${k}.subtle`)] = ok(0.3, 0.03, h);
    out[cssVar(`kind.${k}.muted`)] = ok(0.62, 0.05, h);
  }
  if (light) {
    // chips and diff tints on a dark card: the dark-mode values
    Object.assign(out, {
      [cssVar("boundary.server.fg")]: "#C7C9CE",
      [cssVar("boundary.server.muted")]: "#4A515B",
      [cssVar("boundary.client.fg")]: ok(0.86, 0.08, 215),
      [cssVar("boundary.client.muted")]: ok(0.42, 0.07, 215),
      [cssVar("boundary.shared.fg")]: ok(0.86, 0.08, 355),
      [cssVar("boundary.shared.muted")]: ok(0.42, 0.08, 355),
      [cssVar("diff.added.subtle")]: ok(0.3, 0.06, 150),
      [cssVar("diff.changed.subtle")]: ok(0.32, 0.06, 80),
      [cssVar("diff.removed.subtle")]: ok(0.3, 0.06, 25),
      [cssVar("diff.added.fg")]: ok(0.84, 0.13, 150),
      [cssVar("diff.changed.fg")]: ok(0.86, 0.12, 85),
      [cssVar("diff.removed.fg")]: ok(0.82, 0.12, 25),
    });
  }
  return out;
};

export type DiagramPaletteId = "paper" | "tinted" | "ink" | "graphite";
const SPECS: Record<DiagramPaletteId, PaletteSpec> = { paper, tinted, ink, graphite };
export const DEFAULT_DIAGRAM_PALETTE: DiagramPaletteId = "paper";

/** The palettes in the order the picker lists them. */
export const DIAGRAM_PALETTES: { value: DiagramPaletteId; label: string; hint: string }[] = [
  { value: "paper", label: "Paper", hint: "Warm neutrals; kind colour on icons and edges" },
  { value: "tinted", label: "Tinted", hint: "Each card tinted in its kind's colour" },
  { value: "ink", label: "High contrast", hint: "Ink on white; text at 7 : 1" },
  { value: "graphite", label: "Graphite", hint: "Solid slate blocks; quiet edges" },
];

/** The default palette as semantic token values `{ _light, _dark }`, for theme.ts. */
export const paperTokens = (() => {
  const v = ([light, dark]: Pair) => ({ value: { _light: light, _dark: dark } });
  const kind = (k: KindKey) => {
    const h = paper.hues[k];
    return { solid: v(paper.solid(h)), fg: v(paper.fg(h)), subtle: v(paper.subtle(h)), muted: v(paper.muted(h)) };
  };
  return {
    canvas: { bg: v(paper.canvas), dot: v(paper.dot) },
    card: { bg: v(paper.card), bgSelected: v(paper.cardSelected), border: v(paper.border), frame: v(paper.frame) },
    selection: { solid: v(paper.selection), related: v(paper.related), ring: v(paper.ring) },
    kind: Object.fromEntries(KIND_KEYS.map((k) => [k, kind(k)])) as Record<KindKey, ReturnType<typeof kind>>,
    relation: { imports: v(paper.imports), ...Object.fromEntries(Object.entries(RELATION_KIND).map(([r, k]) => [r, v(paper.relation(paper.hues[k]))])) } as Record<"imports" | keyof typeof RELATION_KIND, ReturnType<typeof v>>,
    diff: Object.fromEntries(Object.entries(paper.diff).map(([d, pair]) => [d, v(pair)])) as Record<"added" | "changed" | "removed", ReturnType<typeof v>>,
  };
})();

/** `kind.serverAction.solid` → `--chakra-colors-kind-server-action-solid`. */
const cssVar = (path: string) => `--chakra-colors-${path.replace(/\./g, "-").replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;

/** Each palette's CSS variables, one side (0 light, 1 dark). */
function variablesOf(p: PaletteSpec, side: 0 | 1): Record<string, string> {
  const out: Record<string, string> = {
    [cssVar("canvas.bg")]: p.canvas[side],
    [cssVar("canvas.dot")]: p.dot[side],
    [cssVar("card.bg")]: p.card[side],
    [cssVar("card.bgSelected")]: p.cardSelected[side],
    [cssVar("card.border")]: p.border[side],
    [cssVar("card.frame")]: p.frame[side],
    [cssVar("selection.solid")]: p.selection[side],
    [cssVar("selection.related")]: p.related[side],
    [cssVar("selection.ring")]: p.ring[side],
    [cssVar("relation.imports")]: p.imports[side],
  };
  for (const k of KIND_KEYS) {
    const h = p.hues[k];
    out[cssVar(`kind.${k}.solid`)] = p.solid(h)[side];
    out[cssVar(`kind.${k}.fg`)] = p.fg(h)[side];
    out[cssVar(`kind.${k}.subtle`)] = p.subtle(h)[side];
    out[cssVar(`kind.${k}.muted`)] = p.muted(h)[side];
  }
  for (const [r, k] of Object.entries(RELATION_KIND)) out[cssVar(`relation.${r}`)] = p.relation(p.hues[k])[side];
  for (const [d, pair] of Object.entries(p.diff)) out[cssVar(`diff.${d}.solid`)] = pair[side];
  return out;
}

/**
 * The CSS of the palettes other than the default: their variables on <html> by `data-palette`,
 * light then dark (`html.dark[…]` is the more specific). Graphite's cards get theirs on the cards.
 */
const diagramPaletteCss: Record<string, Record<string, string>> = (() => {
  const css: Record<string, Record<string, string>> = {};
  for (const [id, p] of Object.entries(SPECS)) {
    if (id === DEFAULT_DIAGRAM_PALETTE) continue;
    css[`html[data-palette="${id}"]`] = variablesOf(p, 0);
    css[`html.dark[data-palette="${id}"]`] = variablesOf(p, 1);
  }
  css[`html[data-palette="graphite"] .rae-card`] = GRAPHITE_CARDS(0);
  css[`html.dark[data-palette="graphite"] .rae-card`] = GRAPHITE_CARDS(1);
  return css;
})();

// ---- the chosen palette ----------------------------------------------------------------------

const KEY = "rae.palette";
const listeners = new Set<() => void>();
const isId = (v: unknown): v is DiagramPaletteId => typeof v === "string" && v in SPECS;

function read(): DiagramPaletteId {
  try {
    const v = localStorage.getItem(KEY);
    return isId(v) ? v : DEFAULT_DIAGRAM_PALETTE;
  } catch {
    return DEFAULT_DIAGRAM_PALETTE;
  }
}

const STYLE_ID = "rae-diagram-palettes";

/** Adds the palettes' CSS to the page once, unlayered (see the top of this file). */
function installDiagramPalettes() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = Object.entries(diagramPaletteCss)
    .map(([selector, vars]) => `${selector} {\n${Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`)
    .join("\n");
  document.head.appendChild(style);
}

function apply(id: DiagramPaletteId) {
  installDiagramPalettes();
  if (id === DEFAULT_DIAGRAM_PALETTE) document.documentElement.removeAttribute("data-palette");
  else document.documentElement.setAttribute("data-palette", id);
}

/** Applies the stored palette (call once at startup, after the stored settings are in). */
export function applyStoredDiagramPalette() {
  apply(read());
}

/** Picks a palette for the diagram: applied at once and remembered. */
export function setDiagramPalette(id: DiagramPaletteId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // not stored: still applied for this session
  }
  apply(id);
  for (const l of listeners) l();
}

/** The palette in use. */
export function useDiagramPalette(): DiagramPaletteId {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (isId(document.documentElement.getAttribute("data-palette")) ? (document.documentElement.getAttribute("data-palette") as DiagramPaletteId) : DEFAULT_DIAGRAM_PALETTE),
  );
}
