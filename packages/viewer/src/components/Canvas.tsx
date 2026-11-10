import { ContextMenu, ShortcutLegend, type Shortcut, tokenVar, useColorMode } from "@rae/design-system";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MiniMap,
  type NodeChange,
  Panel as FlowPanel,
  ReactFlow,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FOLDER_PREFIX } from "../graph/drawn.ts";
import { collapseFrames } from "../graph/collapse.ts";
import { layoutAll } from "../graph/layout.ts";
import { absoluteRect } from "../graph/placement.ts";
import { KIND_META } from "../lib/kinds.tsx";
import { useExplorer, useRelationFilter } from "../store.ts";
import "./canvas.css";
import { HistoryButtons, RelationFilters } from "./canvas/CanvasChrome.tsx";
import { useCanvasEdges } from "./canvas/edges.ts";
import { useCanvasNodes, useRelated } from "./canvas/nodes.ts";
import { useCanvasKeys } from "./canvas/useCanvasKeys.ts";
import { useMarquee } from "./canvas/useMarquee.ts";
import { useNodeDrag } from "./canvas/useNodeDrag.ts";
import { useNodeTooltip } from "./canvas/useNodeTooltip.ts";
import { ConditionEdge } from "./ConditionEdge.tsx";
import { NodeDiffModal } from "./NodeDiffModal.tsx";
import { collapseLevelOf, type Lod, LodContext, lodOf, nextLod } from "./lod.ts";
import { containsEntries, nodeMenuEntries } from "./nodeMenu.tsx";
import { ExplorationPicker } from "./picker/ExplorationPicker.tsx";
import { QuickAdd } from "./picker/QuickAdd.tsx";
import { NodeTooltip } from "./NodeTooltip.tsx";
import { CardNode } from "./nodes/CardNode.tsx";
import { FrameNode } from "./nodes/FrameNode.tsx";
import { type ElementFlowNode, FRAME_HANDLE } from "./nodes/types.ts";

/*
 * The diagram: React Flow over the store's placed elements. The parts live in ./canvas/: the node
 * and edge pipelines (nodes.ts, edges.ts), dragging, the tooltip, the keyboard, box selection and
 * the canvas's own controls. This file wires them, keeps React Flow's local nodes in sync, and
 * moves the viewport (full layouts, fits, focus).
 */

const nodeTypes = { card: CardNode, frame: FrameNode };
const edgeTypes = { condition: ConditionEdge };

const SHORTCUTS: Shortcut[] = [
  { keys: ["Space"], does: "Add to the diagram" },
  { keys: ["⌘ K", "Ctrl K"], does: "Search and add" },
  { keys: ["Right-click"], does: "On the empty canvas, add an element there" },
  { keys: ["Right-click"], does: "On an element, all its actions and relations" },
  { keys: ["Double-click"], does: "Zoom in (also inside a frame)" },
  { keys: ["Drag"], does: "Pan, also inside a file or folder frame" },
  { keys: ["⌘", "Ctrl", "⇧"], does: "With a click, add to the selection" },
  { keys: ["⇧ Drag"], does: "On empty space, draw a box: what it touches joins the selection" },
  { keys: ["⌘ A", "Ctrl A"], does: "Select every element on the diagram" },
  { keys: ["Delete", "⌫"], does: "Remove the selected elements" },
  { keys: ["⌘ Z", "Ctrl Z"], does: "Undo a step" },
  { keys: ["⇧ ⌘ Z", "Ctrl Y"], does: "Redo it" },
  { keys: ["Esc"], does: "Clear the selection, close the menu" },
  { keys: ["⌘ [", "Back"], does: "The previously selected element (⌘ ] / Forward: the next); also the ← → buttons below" },
];

/** Fitting keeps clear of the canvas chrome: the relation filters on top, the controls and minimap below. */
const FIT_PADDING = { top: "68px", bottom: "64px", left: "48px", right: "48px" } as const;
const FIT = { padding: FIT_PADDING, maxZoom: 1, duration: 350 } as const;

/**
 * Runs a viewport change once React Flow knows the nodes: with hundreds of new nodes its
 * internal lookup can lag a frame or two behind our state, and fitView then does nothing.
 */
function whenReady(attempt: () => boolean | Promise<boolean>, tries = 10) {
  requestAnimationFrame(() => {
    void Promise.resolve(attempt()).then((ok) => {
      if (!ok && tries > 1) whenReady(attempt, tries - 1);
    });
  });
}

export function Canvas() {
  const snapshot = useExplorer((s) => s.snapshot);
  const index = useExplorer((s) => s.index);
  const graph = useExplorer((s) => s.graph);
  const placed = useExplorer((s) => s.placed);
  const layoutToken = useExplorer((s) => s.layoutToken);
  const selection = useExplorer((s) => s.selection);
  const focusId = useExplorer((s) => s.focusId);
  const fitIds = useExplorer((s) => s.fitIds);
  const diffOverlay = useExplorer((s) => s.diffOverlay);
  const { select, consumeFocus, applyLayout } = useExplorer.getState();
  const flow = useReactFlow();
  // the level of detail: a bucket of the zoom (with some hysteresis), so this re-renders only when it changes
  const lodRef = useRef<Lod | null>(null);
  const lod = useStore((s) => (lodRef.current = lodRef.current ? nextLod(s.transform[2], lodRef.current) : lodOf(s.transform[2])));
  const menu = useExplorer((s) => s.menu);
  const setMenu = useExplorer.getState().openMenu;
  const tooltip = useNodeTooltip();
  const { tip } = tooltip;
  const { adding, boxing } = useCanvasKeys();
  const marquee = useMarquee();

  // Full ELK layout when the store asks for one.
  useEffect(() => {
    if (!layoutToken) return;
    const g = useExplorer.getState().graph;
    let live = true;
    void layoutAll(g).then((p) => {
      if (!live) return;
      applyLayout(g, p);
      const s = useExplorer.getState();
      if (!s.focusId && !s.fitIds) whenReady(() => flow.getNodes().length >= p.length && flow.fitView(FIT));
    });
    return () => {
      live = false;
    };
  }, [layoutToken, applyLayout, flow]);

  const filter = useRelationFilter();
  // diff snapshots, overlay on: what changed is marked
  const showDiff = !!snapshot?.diff && diffOverlay;
  const related = useRelated(selection, graph);
  // Zoomed far out, frames are blocks: what's inside is hidden (React Flow keeps the nodes and their
  // measurements), the frame says how many it holds.
  const collapse = useMemo(() => collapseFrames(placed, collapseLevelOf(lod, placed.length)), [placed, lod]);
  const selectedNodes = useCanvasNodes({ snapshot, index, placed, filter, showDiff, collapse, selection, related });
  const edges = useCanvasEdges({ graph, placed, showDiff, collapse, related, lod });

  // React Flow applies drags and measurements locally; re-sync when the placement or selection
  // changes ("adjust state during render"). A node whose source didn't change keeps its local
  // object (with React Flow's measurements), so memoized nodes skip re-rendering and React Flow
  // doesn't re-measure everything; changed nodes carry their measurements over.
  const [nodes, setNodes] = useState(selectedNodes);
  const [synced, setSynced] = useState(selectedNodes);
  if (synced !== selectedNodes) {
    const before = new Map(synced.map((n) => [n.id, n]));
    const local = new Map(nodes.map((n) => [n.id, n]));
    setSynced(selectedNodes);
    setNodes(
      selectedNodes.map((n) => {
        const mine = local.get(n.id);
        if (!mine) return n;
        return before.get(n.id) === n ? mine : ({ ...n, measured: mine.measured } as ElementFlowNode);
      }),
    );
  }

  // Selection is entirely the store's: React Flow's own "select" changes (it marks clicked nodes
  // selected internally) are dropped, or a node deselected by the app would keep its outline.
  const onNodesChange = useCallback((changes: NodeChange<ElementFlowNode>[]) => {
    const kept = changes.filter((c) => c.type !== "select");
    if (kept.length) setNodes((ns) => applyNodeChanges(kept, ns));
  }, []);

  const drag = useNodeDrag(setNodes, tooltip.hide);

  // Fit expanded nodes into view once they are placed.
  useEffect(() => {
    if (!fitIds?.length || focusId) return;
    const drawn = fitIds.filter((id) => placed.some((p) => p.element.id === id));
    if (!drawn.length) return;
    consumeFocus();
    whenReady(() => drawn.every((id) => flow.getNode(id)) && flow.fitView({ ...FIT, nodes: drawn.map((id) => ({ id })) }));
  }, [fitIds, focusId, placed, flow, consumeFocus]);

  // Center on a newly added node once it is placed.
  useEffect(() => {
    if (!focusId) return;
    const r = absoluteRect(placed, focusId);
    if (!r) return;
    consumeFocus();
    requestAnimationFrame(
      () => void flow.setCenter(r.x + r.width / 2, r.y + r.height / 2, { zoom: Math.max(flow.getZoom(), 0.9), duration: 400 }),
    );
  }, [focusId, placed, flow, consumeFocus]);

  const colorMode = useColorMode();
  const menuNode = menu ? snapshot?.nodes[menu.id] : undefined;
  const menuEntries = useMemo(() => (menu ? (menu.mode === "contains" ? containsEntries(menu.id) : nodeMenuEntries(menu.id)) : []), [menu]);

  return (
    <div
      className="rae-canvas"
      tabIndex={-1}
      data-selection={selection.length ? "" : undefined}
      data-lod={lod}
      data-dragging={drag.dragging ? "" : undefined}
      data-adding={adding ? "" : undefined}
      data-boxing={boxing ? "" : undefined}
      data-refused-drop={drag.refusedDrop ? "" : undefined}
      // Shift + drag on empty space: a selection box, before React Flow (or a frame's room) pans
      onPointerDownCapture={marquee.onPointerDownCapture}
      // Pressing on the diagram takes focus from any field, so the diagram's shortcuts apply.
      onPointerDown={(e) => {
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== e.currentTarget && active.matches("input, textarea, select")) e.currentTarget.focus({ preventScroll: true });
      }}
    >
      <LodContext.Provider value={lod}>
        <ReactFlow<ElementFlowNode, Edge>
          // React Flow marks its root .light / .dark: it must match ours, or Chakra's tokens inside flip
          colorMode={colorMode}
          // React Flow is MIT: the corner attribution is optional (it sat on top of the minimap)
          proOptions={{ hideAttribution: true }}
          nodes={nodes}
          edges={edges as Edge[]}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          // Read-only diagram: no drawing connections, no React Flow deletion (Delete is ours).
          nodesConnectable={false}
          // Selection is the store's alone: React Flow's own selection (which also flips its internal
          // node state on click) is off; `selected` is passed in and clicks still reach onNodeClick.
          elementsSelectable={false}
          deleteKeyCode={null}
          selectionKeyCode={null}
          // Space adds to the diagram; panning is a plain drag.
          panActivationKeyCode={null}
          multiSelectionKeyCode={null}
          edgesFocusable={false}
          onNodeClick={(e, n) => {
            // Cards select anywhere; frames (files holding elements, folders) only from their header —
            // where they're dragged. Their room acts as empty canvas (FrameNode: click clears, drag pans).
            const target = e.target as HTMLElement;
            if (target.closest(".rae-icon-btn, .rae-contains")) return;
            if (n.type === "frame" && !target.closest(`.${FRAME_HANDLE}`)) return;
            select(n.id, e.metaKey || e.ctrlKey || e.shiftKey);
          }}
          onNodeMouseEnter={tooltip.onNodeMouseEnter}
          onNodeMouseLeave={tooltip.onNodeMouseLeave}
          // A moving view would leave the tooltip behind its node.
          onMoveStart={tooltip.hide}
          onNodeContextMenu={(e, n) => {
            e.preventDefault();
            if (n.data.node && !useExplorer.getState().selection.includes(n.id)) select(n.id);
            setMenu({ x: e.clientX, y: e.clientY, id: n.id, mode: "node" });
          }}
          onPaneContextMenu={(e) => {
            e.preventDefault();
            const s = useExplorer.getState();
            // Quick add: a small picker right there; what's picked lands at that point.
            if (s.snapshot) s.setQuickAdd({ at: { x: e.clientX, y: e.clientY }, anchor: flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }) });
          }}
          onNodeDragStart={drag.onNodeDragStart}
          onNodeDrag={drag.onNodeDrag}
          onNodeDragStop={drag.onNodeDragStop}
          onPaneClick={() => select(undefined)}
          minZoom={0.02}
          maxZoom={2}
          fitView
          fitViewOptions={{ padding: FIT_PADDING, maxZoom: 1 }}
          onlyRenderVisibleElements
        >
          <Background variant={BackgroundVariant.Lines} gap={24} lineWidth={1} color={tokenVar("canvas.grid")} />
          <FlowPanel position="top-left" className="rae-filters">
            <RelationFilters />
          </FlowPanel>
          <Controls position="bottom-left" showInteractive={false} />
          <FlowPanel position="bottom-left" className="rae-history">
            <HistoryButtons />
          </FlowPanel>
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeColor={(n) => {
              const d = (n as ElementFlowNode).data;
              if (d.element.kind === "folder") return "transparent";
              return tokenVar(`kind.${d.element.kind}.${n.type === "frame" ? "subtle" : "solid"}`);
            }}
            nodeStrokeColor={(n) => ((n as ElementFlowNode).type === "frame" ? tokenVar("kind.module.muted") : "transparent")}
          />
        </ReactFlow>
      </LodContext.Provider>
      {/* a removed element takes its tooltip with it (the pointer never "left" it) */}
      {!drag.dragging && !menu && !tooltip.diffOf && (
        <NodeTooltip tip={tip && placed.some((p) => p.element.id === tip.id) ? tip : null} snapshot={snapshot} index={index} {...tooltip.tooltipProps} />
      )}
      {tooltip.diffOf && snapshot && <NodeDiffModal node={tooltip.diffOf} snapshot={snapshot} open onOpenChange={(open) => !open && tooltip.closeDiff()} />}
      {marquee.box && <div className="rae-marquee" style={marquee.box} />}
      <ExplorationPicker />
      <QuickAdd />
      <div className="rae-legend">
        <ShortcutLegend shortcuts={SHORTCUTS} />
      </div>
      <ContextMenu
        at={menu && { x: menu.x, y: menu.y }}
        onClose={() => setMenu(null)}
        entries={menuEntries}
        title={
          menu && (
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{menuNode?.name ?? menu.id.replace(FOLDER_PREFIX, "")}</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>{menuNode ? `${KIND_META[menuNode.kind].label} · ${menuNode.filePath}` : "Folder"}</div>
            </div>
          )
        }
      />
    </div>
  );
}
