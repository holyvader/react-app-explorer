import type { ChangeKind, GraphNode } from "@rae/schema";
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
  /** Components: what they call (functions and server actions), and how many of those aren't drawn. */
  invokes?: number;
  hiddenInvokes?: number;
  /** Components: the props type only they use (`ButtonProps`), named in the caption instead of drawn as a card. */
  propsType?: { id: string; name: string; keyword: string };
  /** Which expansions would add something (components: children = what they render); `routeChain`: routes and route files whose chain isn't all drawn. */
  /** Expansions that would add something. None goes "up to the root" or "down to the leaves", or adds everything inside: those could draw hundreds at once (only the diff view adds many). */
  can: { parents: boolean; children: boolean; invokes?: boolean; routeChain?: boolean; folder?: boolean };
  /** Folders: how many scanned elements (files and declarations) are inside, shown in the header. */
  scannedCount?: number;
  /** File modules: declarations inside not drawn yet (for the "+" on its bottom border). */
  undrawnContents?: number;
  /** Diff snapshots (overlay on): how it changed against the base. */
  change?: ChangeKind;
  /** Zoomed out, a frame drawn as one block: how many drawn elements it hides (graph/collapse.ts). */
  collapsed?: number;
  /** Frame refuses the card being dragged over it. */
  refused?: boolean;
  /**
   * A declaration drawn as a row of its file's list (graph/layout.ts fileListOf): not dragged on its
   * own; `groupStart`: the first of its kind group (a hairline above it).
   */
  row?: { groupStart: boolean };
};

export type CardFlowNode = Node<ElementNodeData, "card">;
export type FrameFlowNode = Node<ElementNodeData, "frame">;
export type ElementFlowNode = CardFlowNode | FrameFlowNode;

/** CSS class of a frame's drag handle (its header). */
export const FRAME_HANDLE = "rae-frame-handle";

/** Handles only anchor edges: invisible and not interactive (the diagram can't be connected by hand). */
export const HIDDEN_HANDLE = { opacity: 0, pointerEvents: "none", width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 } as const;
