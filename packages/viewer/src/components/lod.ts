import { createContext, useContext } from "react";
import type { CollapseLevel } from "../graph/collapse.ts";

/**
 * Level of detail, from the zoom: what the diagram draws when zoomed out.
 * - full (≥ 0.6): everything.
 * - compact (0.3–0.6): names, no captions / chips / actions; edges plain (no dash, no arrows), no labels.
 * - overview (< 0.3): cards as tinted blocks with a large name; frames holding only cards (files)
 *   collapse into blocks, their relations merged per pair (graph/collapse.ts) — on diagrams of
 *   COLLAPSE_FROM elements or more.
 * - far (< 0.12): overview, and every top-level frame (folders too) collapses.
 * Measured (e2e/bench.ts, ~2,800 nodes): dashed edges were most of the raster cost when panning
 * (4 fps at 0.5× with dashes, 60 without), labels and card details the mount cost.
 */
export type Lod = "full" | "compact" | "overview" | "far";
export const COMPACT_BELOW = 0.6;
export const OVERVIEW_BELOW = 0.3;
export const FAR_BELOW = 0.12;
export const lodOf = (zoom: number): Lod => (zoom >= COMPACT_BELOW ? "full" : zoom >= OVERVIEW_BELOW ? "compact" : zoom >= FAR_BELOW ? "overview" : "far");
const ORDER: Lod[] = ["full", "compact", "overview", "far"];
/** How far past a threshold the zoom must go before the level changes: a pinch hovering on one doesn't flip it back and forth. */
const HYSTERESIS = 1.06;
/** The level for `zoom`, staying at `current` until the zoom is clearly past the threshold. */
export function nextLod(zoom: number, current: Lod): Lod {
  const raw = lodOf(zoom);
  if (raw === current) return current;
  const lessDetail = ORDER.indexOf(raw) > ORDER.indexOf(current);
  return lodOf(lessDetail ? zoom * HYSTERESIS : zoom / HYSTERESIS) === raw ? raw : current;
}

/** Overview or far: cards drawn as blocks. */
export const isBlocks = (lod: Lod) => lod === "overview" || lod === "far";
/** Frames collapse only on diagrams this big: a small one costs nothing to draw, and hiding its contents only loses them. */
export const COLLAPSE_FROM = 300;
export const collapseLevelOf = (lod: Lod, drawn: number): CollapseLevel =>
  drawn < COLLAPSE_FROM ? "none" : lod === "far" ? "all" : lod === "overview" ? "files" : "none";

/** Given by the canvas, so nodes and edges re-render when the level changes, not on every zoom step. */
export const LodContext = createContext<Lod>("full");
export const useLod = () => useContext(LodContext);
