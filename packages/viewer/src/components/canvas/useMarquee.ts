import { useReactFlow } from "@xyflow/react";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useState } from "react";
import { useExplorer } from "../../store.ts";

/** How far the pointer moves before a ⌘/Ctrl press becomes a selection box (px). */
const MARQUEE_SLOP = 4;

/**
 * Shift + drag from empty space (the pane, or a frame's room) draws a selection box (React Flow's
 * own default): what it touches joins the selection, live, on top of what was selected before.
 * Cards count when touched; frames only when wholly inside (a box drawn in a frame's room isn't
 * picking the frame). The selection on release is exactly what was highlighted. A press that
 * doesn't move does nothing.
 */
export function useMarquee() {
  const flow = useReactFlow();
  const [box, setBox] = useState<CSSProperties | null>(null);
  const onPointerDownCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !e.shiftKey) return;
    const target = e.target as HTMLElement;
    if (!target.closest(".react-flow__pane, .rae-frame__room") || target.closest(".react-flow__panel")) return;
    e.stopPropagation();
    e.preventDefault();
    const host = e.currentTarget.getBoundingClientRect();
    const from = { x: e.clientX, y: e.clientY };
    const base = useExplorer.getState().selection;
    let frame = 0;
    let last: PointerEvent | null = null;
    let started = false;
    const update = () => {
      frame = 0;
      if (!last) return;
      const x0 = Math.min(from.x, last.clientX);
      const y0 = Math.min(from.y, last.clientY);
      const x1 = Math.max(from.x, last.clientX);
      const y1 = Math.max(from.y, last.clientY);
      setBox({ left: x0 - host.left, top: y0 - host.top, width: x1 - x0, height: y1 - y0 });
      const a = flow.screenToFlowPosition({ x: x0, y: y0 });
      const b = flow.screenToFlowPosition({ x: x1, y: y1 });
      const rect = { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
      // frames only when wholly inside the box
      const inside = (id: string) => {
        const n = flow.getInternalNode(id);
        if (!n) return false;
        const { x, y } = n.internals.positionAbsolute;
        const w = n.measured.width ?? 0;
        const h = n.measured.height ?? 0;
        return x >= rect.x && y >= rect.y && x + w <= rect.x + rect.width && y + h <= rect.y + rect.height;
      };
      const touched = flow.getIntersectingNodes(rect, true).filter((n) => n.type !== "frame" || inside(n.id));
      const ids = [...base, ...touched.map((n) => n.id).filter((id) => !base.includes(id))];
      const now = useExplorer.getState().selection;
      if (ids.length !== now.length || ids.some((id, i) => id !== now[i])) useExplorer.getState().selectMany(ids);
    };
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < MARQUEE_SLOP) return;
      started = true;
      last = ev;
      if (!frame) frame = requestAnimationFrame(update);
    };
    const end = () => {
      cancelAnimationFrame(frame);
      if (started && last) update();
      setBox(null);
      // the release's click would land on the empty canvas and clear what the box just selected
      if (started) {
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        // no click follows (released outside the window): don't eat the next real one
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  return { box, onPointerDownCapture };
}
