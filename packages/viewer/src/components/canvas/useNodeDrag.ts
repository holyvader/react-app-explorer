import type { OnNodeDrag } from "@xyflow/react";
import { type Dispatch, type SetStateAction, useCallback, useRef, useState } from "react";
import { absoluteRect, type CanvasFrame, landsIn, refusingFrames } from "../../graph/placement.ts";
import { useExplorer } from "../../store.ts";
import type { ElementFlowNode } from "../nodes/types.ts";

/*
 * Dragging an element on the canvas: it's raised over everything while dragged, a frame that won't
 * take it is marked as it's crossed, and on release the store places it (`dropAt`: shoves what it
 * covers, refits its container). React Flow moves the node itself, in the canvas's local nodes.
 */

const RAISED_Z = 1000;

interface Holding {
  id: string;
  /** Absolute position of the dragged element's container. */
  origin: { x: number; y: number };
  start: { x: number; y: number };
  /** Frames it may not land in (gathered once: frames don't move during a drag). */
  refusing: CanvasFrame[];
  refused?: string;
}

/** `setNodes`: the canvas's local nodes; `onStart`: what else a drag puts away (the tooltip). */
export function useNodeDrag(setNodes: Dispatch<SetStateAction<ElementFlowNode[]>>, onStart: () => void) {
  const { dropAt } = useExplorer.getState();
  const [dragging, setDragging] = useState(false);
  /** The dragged element is over a frame that won't take it. */
  const [refusedDrop, setRefusedDrop] = useState(false);

  // Dragging: the element is raised over everything; a frame it would be refused by is marked.
  const holding = useRef<Holding | null>(null);
  const patchNode = useCallback(
    (id: string | undefined, patch: (n: ElementFlowNode) => ElementFlowNode) =>
      id && setNodes((ns) => ns.map((n) => (n.id === id ? patch(n) : n))),
    [setNodes],
  );
  const markRefused = useCallback(
    (id: string | undefined, refused: boolean) => patchNode(id, (n) => ({ ...n, data: { ...n.data, refused } }) as ElementFlowNode),
    [patchNode],
  );

  const onNodeDragStart = useCallback<OnNodeDrag<ElementFlowNode>>(
    (_, node) => {
      const s = useExplorer.getState();
      const parent = node.parentId ? absoluteRect(s.placed, node.parentId) : undefined;
      holding.current = {
        id: node.id,
        origin: { x: parent?.x ?? 0, y: parent?.y ?? 0 },
        start: node.position,
        refusing: refusingFrames(s.placed, s.graph, node.id),
      };
      setDragging(true);
      onStart();
      patchNode(node.id, (n) => ({ ...n, zIndex: RAISED_Z }));
    },
    [patchNode, onStart],
  );

  const onNodeDrag = useCallback<OnNodeDrag<ElementFlowNode>>(
    (_, node) => {
      const h = holding.current;
      if (!h) return;
      const rect = { x: h.origin.x + node.position.x, y: h.origin.y + node.position.y, width: node.width ?? 0, height: node.height ?? 0 };
      const into = landsIn(h.refusing, rect)?.id;
      if (into === h.refused) return;
      markRefused(h.refused, false);
      markRefused(into, true);
      h.refused = into;
      setRefusedDrop(!!into);
    },
    [markRefused],
  );

  const onNodeDragStop = useCallback<OnNodeDrag<ElementFlowNode>>(
    (_, node) => {
      const h = holding.current;
      holding.current = null;
      setDragging(false);
      setRefusedDrop(false);
      if (!h) return;
      markRefused(h.refused, false);
      patchNode(node.id, (n) => ({ ...n, zIndex: undefined }));
      if (h.start.x === node.position.x && h.start.y === node.position.y) return;
      dropAt(node.id, { x: h.origin.x + node.position.x, y: h.origin.y + node.position.y });
    },
    [dropAt, markRefused, patchNode],
  );
  return { dragging, refusedDrop, onNodeDragStart, onNodeDrag, onNodeDragStop };
}
