import { ContextMenu, type Shortcut, tokenVar, useColorMode } from "@rae/design-system";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  type Edge,
  type NodeChange,
  Panel,
  ReactFlow,
  getViewportForBounds,
  useReactFlow,
  useStore,
  useStoreApi,
} from "@xyflow/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FOLDER_PREFIX } from "../graph/drawn.ts";
import { collapseFrames } from "../graph/collapse.ts";
import { layoutOffThread } from "../graph/layoutOffThread.ts";
import type { PlacedElement } from "../graph/layout.ts";
import { absoluteRect } from "../graph/placement.ts";
import { KIND_META } from "../lib/kinds.tsx";
import { diagramKey, useExplorer, useRelationFilter } from "../store.ts";
import "./canvas.css";
import { CanvasStatusBar } from "./canvas/CanvasChrome.tsx";
import { ScriptsConsole } from "./scripts/ScriptsConsole.tsx";
import { useScripts } from "../lib/scripts.ts";
import { useCanvasEdges } from "./canvas/edges.ts";
import { EdgeLabelLayer } from "./canvas/edgeLabelLayer.ts";
import { Minimap } from "./canvas/Minimap.tsx";
import { useCanvasNodes, useRelated } from "./canvas/nodes.ts";
import { useCanvasKeys } from "./canvas/useCanvasKeys.ts";
import { useMarquee } from "./canvas/useMarquee.ts";
import { atStart, glideOf, GLIDE_MS, useGlide } from "./canvas/useGlide.ts";
import { useNodeDrag } from "./canvas/useNodeDrag.ts";
import { useNodeTooltip } from "./canvas/useNodeTooltip.ts";
import { ConditionEdge } from "./ConditionEdge.tsx";
import { NodeCodeModal } from "./NodeCodeModal.tsx";
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
const FIT_PADDING = { top: "48px", bottom: "48px", left: "48px", right: "48px" } as const;
const FIT = { padding: FIT_PADDING, maxZoom: 1, duration: 350 } as const;
/** Flowing relations: only while at most this many edges are drawn (more costs frames). */
const ANIMATE_ALL = 120;
/** How far inside the canvas edge revealed elements must be to count as in view (screen px). */
const REVEAL_MARGIN = 48;
/** Revealing zooms out to at most this share of the current zoom to keep the current view; beyond it, it goes to them. */
const REVEAL_MIN_SCALE = 0.5;

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
  // the code diff dialog (diff snapshots), opened from a card's action or its tooltip
  // the code dialog: the element its history is at, as code or as its diff (components/codeNav.tsx)
  const codeEntry = useExplorer((s) => s.codeView?.stack[s.codeView.at]);
  const codeNode = codeEntry ? snapshot?.nodes[codeEntry.id] : undefined;
  const codeOf = codeEntry && !codeEntry.diff ? codeNode : undefined;
  const codeDiffOf = codeEntry?.diff ? codeNode : undefined;
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
  const flowStore = useStoreApi();
  /** Fits the view to a placing (its top-level elements' bounds), gliding as long as the nodes do. */
  const fitPlacement = useCallback(
    (placing: readonly PlacedElement[]) => {
      const top = placing.filter((p) => p.element.parent === null);
      if (!top.length) return false;
      const x = Math.min(...top.map((p) => p.x));
      const y = Math.min(...top.map((p) => p.y));
      const bounds = { x, y, width: Math.max(...top.map((p) => p.x + p.width)) - x, height: Math.max(...top.map((p) => p.y + p.height)) - y };
      const { width, height, minZoom } = flowStore.getState();
      void flow.setViewport(getViewportForBounds(bounds, width, height, minZoom, FIT.maxZoom, FIT_PADDING), { duration: Math.max(FIT.duration, GLIDE_MS) });
      return true;
    },
    [flow, flowStore],
  );
  /**
   * Brings placed elements into view with the least change: nothing when they are already in view;
   * otherwise it zooms out just enough to show them beside what is in view now (never zooming in),
   * or, when they are too far for that, goes to them. Reads where they are going (`placed`), not
   * where they are drawn while gliding there.
   */
  const reveal = useCallback(
    (placing: readonly PlacedElement[], ids: readonly string[]) => {
      const rects = ids.map((id) => absoluteRect(placing, id)).filter((r) => !!r);
      if (!rects.length) return false;
      const x = Math.min(...rects.map((r) => r.x));
      const y = Math.min(...rects.map((r) => r.y));
      const bounds = { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y };
      const { width, height, minZoom, transform } = flowStore.getState();
      const [tx, ty, zoom] = transform;
      const pad = REVEAL_MARGIN / zoom;
      const view = { x: -tx / zoom + pad, y: -ty / zoom + pad, width: width / zoom - 2 * pad, height: height / zoom - 2 * pad };
      const inView =
        bounds.x >= view.x && bounds.y >= view.y && bounds.x + bounds.width <= view.x + view.width && bounds.y + bounds.height <= view.y + view.height;
      if (inView) return true;
      const ux = Math.min(view.x, bounds.x);
      const uy = Math.min(view.y, bounds.y);
      const union = { x: ux, y: uy, width: Math.max(view.x + view.width, bounds.x + bounds.width) - ux, height: Math.max(view.y + view.height, bounds.y + bounds.height) - uy };
      let next = getViewportForBounds(union, width, height, minZoom, zoom, FIT_PADDING);
      // so far away that keeping the current view would shrink everything: go to them instead
      if (next.zoom < zoom * REVEAL_MIN_SCALE) next = getViewportForBounds(bounds, width, height, minZoom, Math.max(zoom, FIT.maxZoom), FIT_PADDING);
      void flow.setViewport(next, { duration: Math.max(FIT.duration, GLIDE_MS) });
      return true;
    },
    [flow, flowStore],
  );
  // the level of detail: a bucket of the zoom (with some hysteresis), so this re-renders only when it changes
  const lodRef = useRef<Lod | null>(null);
  const lod = useStore((s) => (lodRef.current = lodRef.current ? nextLod(s.transform[2], lodRef.current) : lodOf(s.transform[2])));
  // React Flow's edge label layer, found once: labels portal into it (canvas/edgeLabels.tsx)
  const shellRef = useRef<HTMLDivElement>(null);
  const [labelLayer, setLabelLayer] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setLabelLayer(shellRef.current?.querySelector<HTMLElement>(".react-flow__edgelabel-renderer") ?? null), []);
  const menu = useExplorer((s) => s.menu);
  const setMenu = useExplorer.getState().openMenu;
  const tooltip = useNodeTooltip();
  const { tip } = tooltip;
  // Flowing relations (Settings), paused while the view moves. Every frame repaints the area of
  // every moving edge, with every edge drawn there: ~90 edges on screen cost nothing (~185: 60 → 48 fps); with 850, all
  // of them flowing took WebKit from 60 fps to 7, and even the selection's 12 to 28. So they flow
  // only while at most ANIMATE_ALL edges are drawn (`data-animate`, recounted when the view stops or
  // the edges change). Both attributes are set on the element directly: panning and zooming don't
  // re-render the canvas.
  const animateEdges = useExplorer((s) => s.animateEdges);
  const canvasRef = useRef<HTMLDivElement>(null);
  const updateAnimate = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    if (useExplorer.getState().animateEdges && el.querySelectorAll(".react-flow__edge").length <= ANIMATE_ALL) el.setAttribute("data-animate", "");
    else el.removeAttribute("data-animate");
  }, []);
  const hideTip = tooltip.hide;
  const onMoveStart = useCallback(() => {
    hideTip();
    canvasRef.current?.setAttribute("data-moving", "");
  }, [hideTip]);
  const onMoveEnd = useCallback(() => {
    canvasRef.current?.removeAttribute("data-moving");
    updateAnimate();
  }, [updateAnimate]);
  const { adding, boxing } = useCanvasKeys();
  const marquee = useMarquee();

  // A full layout (graph/squareLayout.ts) when the store asks for one.
  useEffect(() => {
    if (!layoutToken) return;
    const { graph: g, layoutEffort, layoutMode } = useExplorer.getState();
    let live = true;
    void layoutOffThread(g, null, layoutEffort, layoutMode, "canvas")
      .then((p) => {
        // stale: the diagram changed meanwhile (a newer layout is on its way) — neither placed nor fitted
        if (!live || useExplorer.getState().graph !== g) return;
        applyLayout(g, p);
        const s = useExplorer.getState();
        // the view goes where the nodes are going, while they glide there (fitView would read where they start)
        if (!s.focusId && !s.fitIds) whenReady(() => flow.getNodes().length >= p.length && fitPlacement(p));
      })
      .catch(() => {
        /* superseded by a newer layout */
      });
    return () => {
      live = false;
    };
  }, [layoutToken, applyLayout, flow, fitPlacement]);

  const filter = useRelationFilter();
  // diff snapshots, overlay on: what changed is marked
  const showDiff = !!snapshot?.diff && diffOverlay;
  const bigFile = useExplorer((s) => s.bigFile);
  const related = useRelated(selection, graph);
  // Zoomed far out, frames are blocks: what's inside is hidden (React Flow keeps the nodes and their
  // measurements), the frame says how many it holds.
  const collapse = useMemo(() => collapseFrames(placed, collapseLevelOf(lod, placed.length)), [placed, lod]);
  const selectedNodes = useCanvasNodes({ snapshot, index, placed, filter, showDiff, collapse, selection, related, bigFile });
  const edges = useCanvasEdges({ graph, placed, showDiff, collapse, related, lod });
  // which flowing relations: recounted once the edges are drawn
  useEffect(() => {
    const raf = requestAnimationFrame(updateAnimate);
    return () => cancelAnimationFrame(raf);
  }, [edges, animateEdges, updateAnimate]);

  // React Flow applies drags and measurements locally; re-sync when the placement or selection
  // changes ("adjust state during render"). A node whose source didn't change keeps its local
  // object (with React Flow's measurements), so memoized nodes skip re-rendering and React Flow
  // doesn't re-measure everything; changed nodes carry their measurements over.
  // What moves glides there (canvas/useGlide.ts): the nodes start where they are drawn now.
  const [nodes, setNodes] = useState(selectedNodes);
  const [synced, setSynced] = useState(selectedNodes);
  const drag = useNodeDrag(setNodes, tooltip.hide);
  const startGlide = useGlide(setNodes, drag.dragging);
  if (synced !== selectedNodes) {
    const before = new Map(synced.map((n) => [n.id, n]));
    const local = new Map(nodes.map((n) => [n.id, n]));
    setSynced(selectedNodes);
    const next = selectedNodes.map((n) => {
      const mine = local.get(n.id);
      if (!mine) return n;
      return before.get(n.id) === n ? mine : ({ ...n, measured: mine.measured } as ElementFlowNode);
    });
    const glide = drag.dragging ? null : glideOf(nodes, next);
    setNodes(glide ? atStart(next, glide) : next);
    startGlide(glide);
  }

  // Selection is entirely the store's: React Flow's own "select" changes (it marks clicked nodes
  // selected internally) are dropped, or a node deselected by the app would keep its outline.
  const onNodesChange = useCallback((changes: NodeChange<ElementFlowNode>[]) => {
    const kept = changes.filter((c) => c.type !== "select");
    if (kept.length) setNodes((ns) => applyNodeChanges(kept, ns));
  }, []);


  // A project (or a comparison) just opened: the view fits its diagram once it's placed — a restored
  // diagram comes back without a layout, which would have fitted it. Keyed by the diagram, not the
  // snapshot: a background refresh swaps in a fresh copy of the same project and the view stays.
  const fitOnOpen = useRef<string | null>(null);
  useEffect(() => {
    const key = snapshot ? diagramKey(snapshot) : null;
    if (!key || fitOnOpen.current === key) return;
    fitOnOpen.current = key;
    // nothing restored: what gets added later fits itself (or the layout does)
    if (!placed.length) return;
    const placing = placed;
    whenReady(() => flow.getNodes().length >= placing.length && fitPlacement(placing));
  }, [snapshot, placed, flow, fitPlacement]);

  // Fit expanded nodes into view once they are placed.
  useEffect(() => {
    if (!fitIds?.length || focusId) return;
    const drawn = fitIds.filter((id) => placed.some((p) => p.element.id === id));
    if (!drawn.length) return;
    consumeFocus();
    whenReady(() => drawn.every((id) => flow.getNode(id)) && reveal(placed, drawn));
  }, [fitIds, focusId, placed, flow, consumeFocus, reveal]);

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

  // the open folder's package.json scripts (the status bar's Scripts, ⌘K's `>`)
  const rootDir = snapshot?.rootDir;
  useEffect(() => void useScripts.getState().load(rootDir), [rootDir]);

  const colorMode = useColorMode();
  const [minimap, setMinimap] = useMinimap();
  const menuNode = menu ? snapshot?.nodes[menu.id] : undefined;
  const menuEntries = useMemo(() => (menu ? (menu.mode === "contains" ? containsEntries(menu.id) : nodeMenuEntries(menu.id)) : []), [menu]);

  return (
    <div className="rae-canvas-shell" ref={shellRef}>
      <div
        className="rae-canvas"
        ref={canvasRef}
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
          <EdgeLabelLayer.Provider value={labelLayer}>
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
            onMoveStart={onMoveStart}
            onMoveEnd={onMoveEnd}
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
            // no `fitView` here: the view is fitted by the layout (fitPlacement) and expansions (reveal).
            // React Flow's own first fit runs once its nodes count as measured — at once, since they
            // declare their handles — and fitted whatever was there first.
            onlyRenderVisibleElements
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1.4} color={tokenVar("canvas.dot")} />
            {minimap && (
              <Panel position="bottom-right">
                <Minimap placed={placed} />
              </Panel>
            )}
          </ReactFlow>
          </EdgeLabelLayer.Provider>
        </LodContext.Provider>
        {/* a removed element takes its tooltip with it (the pointer never "left" it) */}
        {!drag.dragging && !menu && !codeDiffOf && !codeOf && (
          <NodeTooltip tip={tip && placed.some((p) => p.element.id === tip.id) ? tip : null} snapshot={snapshot} index={index} {...tooltip.tooltipProps} />
        )}
        {codeOf && snapshot && <NodeCodeModal node={codeOf} snapshot={snapshot} onClose={() => useExplorer.getState().showCode(undefined)} />}
        {codeDiffOf && snapshot && <NodeDiffModal node={codeDiffOf} snapshot={snapshot} open onOpenChange={(open) => !open && useExplorer.getState().showCodeDiff(undefined)} />}
        {marquee.box && <div className="rae-marquee" style={marquee.box} />}
        <ExplorationPicker />
        <QuickAdd />
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
      <ScriptsConsole />
      <CanvasStatusBar shortcuts={SHORTCUTS} minimap={minimap} onMinimap={setMinimap} fitPadding={FIT_PADDING} />
    </div>
  );
}

const MINIMAP_KEY = "rae.minimap";

/** Whether the minimap shows (the status bar's switch), remembered across sessions; on by default. */
function useMinimap() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(MINIMAP_KEY) !== "off";
    } catch {
      return true;
    }
  });
  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(MINIMAP_KEY, next ? "on" : "off");
    } catch {
      /* private mode: just for this session */
    }
  }, []);
  return [on, set] as const;
}
