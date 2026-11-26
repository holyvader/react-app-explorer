import { type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";
import { EdgeLabelLayer } from "./edgeLabelLayer.ts";

/** An edge's label, drawn in React Flow's label layer (HTML over the edges, moving with the viewport). */
export function EdgeLabel({ children }: { children: ReactNode }) {
  const layer = useContext(EdgeLabelLayer);
  return layer ? createPortal(children, layer) : null;
}
