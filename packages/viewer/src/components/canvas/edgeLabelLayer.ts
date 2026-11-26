import { createContext } from "react";

/**
 * Where edge labels go: React Flow's label layer (`.react-flow__edgelabel-renderer`), found once by
 * the canvas. React Flow's own `EdgeLabelRenderer` looks the layer up with a store selector — one
 * `querySelector` per label on every store change, every zoom step included: with hundreds of
 * labels that was the biggest single cost of zooming (e2e/zoomProfile.ts).
 */
export const EdgeLabelLayer = createContext<HTMLElement | null>(null);
