import { IconFolder } from "@rae/design-system/icons";
import { Handle, type NodeProps, Position, useReactFlow, useStoreApi } from "@xyflow/react";
import { memo, type MouseEvent, type PointerEvent } from "react";
import { CHANGE_LETTER, CHANGE_WORD } from "../../lib/diff.ts";
import { KIND_META, renderingKey, renderingLabel, routeCaption } from "../../lib/kinds.tsx";
import { useExplorer } from "../../store.ts";
import { ContainsButton, NodeActions } from "./NodeActions.tsx";
import { FRAME_HANDLE, type FrameFlowNode, HIDDEN_HANDLE } from "./types.ts";

/** How far a pointer may move between press and release and still be a click. */
const CLICK_SLOP = 4;

/**
 * A frame's room is the canvas to the reader: dragged, it pans the view; double-clicked, it zooms
 * in around the pointer; clicked (not dragged), it clears the selection as the empty canvas does.
 * The frame itself is selected, dragged and hovered from its header only. React Flow blocks both
 * panning and zooming on nodes, so they're done here, on the room itself (not what's inside).
 */
function useRoomAsCanvas() {
  const { getViewport, setViewport } = useReactFlow();
  const store = useStoreApi();
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.stopPropagation();
    const room = event.currentTarget;
    const from = { x: event.clientX, y: event.clientY, view: getViewport() };
    room.setPointerCapture(event.pointerId);
    room.dataset.panning = "";
    let frame = 0;
    let last: globalThis.PointerEvent | null = null;
    const move = (to: globalThis.PointerEvent) => {
      last = to;
      // One viewport update per animation frame, however fast the pointer reports.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (last) void setViewport({ ...from.view, x: from.view.x + last.clientX - from.x, y: from.view.y + last.clientY - from.y });
      });
    };
    const end = (to: globalThis.PointerEvent) => {
      cancelAnimationFrame(frame);
      if (to.type === "pointerup" && Math.hypot(to.clientX - from.x, to.clientY - from.y) < CLICK_SLOP) {
        useExplorer.getState().select(undefined);
      } else {
        // Final position from the release itself: fast drags can deliver their (coalesced) moves late.
        void setViewport({ ...from.view, x: from.view.x + to.clientX - from.x, y: from.view.y + to.clientY - from.y });
      }
      delete room.dataset.panning;
      room.removeEventListener("pointermove", move);
      room.removeEventListener("pointerup", end);
      room.removeEventListener("pointercancel", end);
    };
    room.addEventListener("pointermove", move);
    room.addEventListener("pointerup", end);
    room.addEventListener("pointercancel", end);
  };
  const onDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    event.stopPropagation();
    const canvas = event.currentTarget.closest(".react-flow");
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const at = { x: event.clientX - box.left, y: event.clientY - box.top };
    const view = getViewport();
    const zoom = Math.min(store.getState().maxZoom, view.zoom * 2);
    const by = zoom / view.zoom;
    void setViewport({ x: at.x - (at.x - view.x) * by, y: at.y - (at.y - view.y) * by, zoom }, { duration: 250 });
  };
  return { onPointerDown, onDoubleClick };
}

/**
 * A container drawn around what it holds: a file module (its declarations inside) or a folder
 * (files inside). Dragged by its header; what it holds moves with it.
 */
function FrameNodeImpl({ data }: NodeProps<FrameFlowNode>) {
  const { node, element, refused } = data;
  const folder = element.kind === "folder";
  const route = element.kind === "route" ? node?.route : undefined;
  const Icon = folder ? IconFolder : route ? KIND_META.route.icon : KIND_META.module.icon;
  const room = useRoomAsCanvas();
  return (
    <div className="rae-frame" data-kind={folder ? "folder" : route ? "route" : "module"} data-refused={refused || undefined} data-change={data.change}>
      {data.change && (
        <span className="rae-change" data-change={data.change} title={`${CHANGE_WORD[data.change]} in this diff`}>
          {CHANGE_LETTER[data.change]}
        </span>
      )}
      <Handle type="target" position={Position.Top} isConnectable={false} style={HIDDEN_HANDLE} />
      <div className={`rae-frame__header ${FRAME_HANDLE}`}>
        <span className="rae-icon">
          <Icon size={13} />
        </span>
        <div className="rae-frame__title">
          {/* a file by its path, a route by its URL, a folder by its name: one mono line */}
          <div className="rae-name" title={data.path ?? node?.filePath}>
            {!folder && !route && node ? node.filePath : element.name}
          </div>
          {route && <div className="rae-sub">{routeCaption(route)}</div>}
          {folder && data.scannedCount !== undefined && <div className="rae-sub">{data.scannedCount} scanned elements</div>}
        </div>
        {route?.rendering && (
          <span className="rae-chip" data-render={renderingKey(route.rendering)} title={route.rendering.reasons.join("\n")}>
            {renderingLabel(route.rendering)}
          </span>
        )}
        {node?.nextRole && <span className="rae-badge rae-badge--role">{node.nextRole}</span>}
        {node?.moduleType && <span className="rae-chip" data-boundary={node.moduleType}>{node.moduleType}</span>}
        <NodeActions data={data} frame />
      </div>
      <div className="rae-frame__room nopan" {...room} />
      <ContainsButton data={data} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={HIDDEN_HANDLE} />
    </div>
  );
}

export const FrameNode = memo(FrameNodeImpl);
