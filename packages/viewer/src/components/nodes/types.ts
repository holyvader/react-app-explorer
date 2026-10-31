import type { GraphNode } from "@rae/schema";
import type { Node } from "@xyflow/react";
import type { DrawnElement } from "../../graph/drawn.ts";

export type ElementNodeData = {
  element: DrawnElement;
  /** The snapshot node (undefined for folders). */
  node?: GraphNode;
  /** Folder path for folder frames. */
  path?: string;
  parents: number;
  children: number;
  hiddenParents: number;
  hiddenChildren: number;
  /** Folders: how many scanned elements (files and declarations) are inside, shown in the header. */
  scannedCount?: number;
  /** File modules: declarations inside not drawn yet (for the "+" on its bottom border). */
  undrawnContents?: number;
  /** Frame refuses the card being dragged over it. */
  refused?: boolean;
};

export type CardFlowNode = Node<ElementNodeData, "card">;
export type FrameFlowNode = Node<ElementNodeData, "frame">;
export type ElementFlowNode = CardFlowNode | FrameFlowNode;

/** CSS class of a frame's drag handle (its header). */
export const FRAME_HANDLE = "rae-frame-handle";

/** Handles only anchor edges: invisible and not interactive (the diagram can't be connected by hand). */
export const HIDDEN_HANDLE = { opacity: 0, pointerEvents: "none", width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 } as const;
