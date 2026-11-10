import type { GraphNode } from "@rae/schema";
import type { NodeMouseHandler } from "@xyflow/react";
import { useCallback, useRef, useState } from "react";
import { useExplorer } from "../../store.ts";
import type { TipState } from "../NodeTooltip.tsx";
import type { ElementFlowNode } from "../nodes/types.ts";

/*
 * The canvas's one node tooltip: shown 600 ms after the pointer rests on a node, hoverable (leaving
 * the node leaves it TIP_GRACE to be reached; the pointer on it keeps it open; leaving it closes it),
 * put away when the view moves or a drag starts. Its diff column's button opens the code diff dialog,
 * held here so it outlives the tooltip.
 */

const SHOW_DELAY = 600;
/** How long a tooltip stays after the pointer leaves its node: time to reach it (and keep it open). */
const TIP_GRACE = 250;

export function useNodeTooltip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // the grace time after its node is left (apart from showing: crossing a frame on the way keeps it)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // the diff view's code: the hovered element's changed lines in the tooltip, and its code diff dialog
  const diffCode = useExplorer((s) => s.diffOverlay && s.diffCode);
  const [diffOf, setDiffOf] = useState<GraphNode | null>(null);

  /** Puts it away now (a drag, a moving view). Stable: safe in other hooks' dependencies. */
  const hide = useCallback(() => {
    clearTimeout(showTimer.current);
    setTip(null);
  }, []);

  const onNodeMouseEnter = useCallback<NodeMouseHandler<ElementFlowNode>>((e, n) => {
    clearTimeout(showTimer.current);
    // back on the node whose tooltip is open: it stays (another node's leaves when its grace is over)
    setTip((t) => {
      if (t?.id === n.id) clearTimeout(hideTimer.current);
      return t;
    });
    // Folders have no tooltip: their header says what's inside.
    if (!n.data.node) return;
    const el = (e.target as Element).closest(".react-flow__node");
    showTimer.current = setTimeout(() => {
      if (!el?.isConnected) return;
      const r = el.getBoundingClientRect();
      clearTimeout(hideTimer.current);
      setTip({ id: n.id, rect: { left: r.left, top: r.top, width: r.width, bottom: r.bottom } });
    }, SHOW_DELAY);
  }, []);

  // a moment to reach the tooltip: the pointer on it keeps it open
  const onNodeMouseLeave = useCallback<NodeMouseHandler<ElementFlowNode>>((e) => {
    clearTimeout(showTimer.current);
    // onto the tooltip (from its node, or from the frame around it, crossed on the way): it stays
    if ((e.relatedTarget as Element | null)?.closest?.(".rae-tip")) return;
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setTip(null), TIP_GRACE);
  }, []);

  /** The tooltip's own props (besides what it shows). */
  const tooltipProps = {
    diffCode,
    onOpenDiff: (n: GraphNode) => {
      setTip(null);
      setDiffOf(n);
    },
    onPointerEnter: () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
    },
    onPointerLeave: () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
      setTip(null);
    },
  };

  return { tip, hide, onNodeMouseEnter, onNodeMouseLeave, tooltipProps, diffOf, closeDiff: () => setDiffOf(null) };
}
