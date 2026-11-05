import { createContext, useContext } from "react";

/**
 * Level of detail, from the zoom: what the diagram draws when zoomed out.
 * - full (≥ 0.6): everything.
 * - compact (0.3–0.6): names, no captions / chips / actions; edges plain (no dash, no arrows), no labels.
 * - overview (< 0.3): cards as tinted blocks with a large name, frames with a large title.
 * Measured (e2e/bench.ts, ~2,800 nodes): dashed edges were most of the raster cost when panning
 * (4 fps at 0.5× with dashes, 60 without), labels and card details the mount cost.
 */
export type Lod = "full" | "compact" | "overview";
export const COMPACT_BELOW = 0.6;
export const OVERVIEW_BELOW = 0.3;
export const lodOf = (zoom: number): Lod => (zoom >= COMPACT_BELOW ? "full" : zoom >= OVERVIEW_BELOW ? "compact" : "overview");

/** Given by the canvas, so nodes and edges re-render when the level changes, not on every zoom step. */
export const LodContext = createContext<Lod>("full");
export const useLod = () => useContext(LodContext);
