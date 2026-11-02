import type { Edge as GraphEdge } from "@rae/schema";
import { ContextMenu, ShortcutLegend, type Shortcut } from "@rae/design-system";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  type NodeChange,
  type OnNodeDrag,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FOLDER_PREFIX, isFolder } from "../graph/drawn.ts";
import { folderExpansion, folderPath, parentFolders } from "../graph/folder.ts";
import { layoutAll } from "../graph/layout.ts";
import { absoluteRect, type CanvasFrame, landsIn, refusingFrames } from "../graph/placement.ts";
import { childEdges, hasUndrawn, parentEdges } from "../graph/relations.ts";
import { KIND_META } from "../lib/kinds.tsx";
import { relationFilterOf, useExplorer } from "../store.ts";
import "./canvas.css";
import { ConditionEdge, type ConditionFlowEdge } from "./ConditionEdge.tsx";
import { containsEntries, nodeMenuEntries } from "./nodeMenu.tsx";
import { ExplorationPicker } from "./picker/ExplorationPicker.tsx";
import { QuickAdd } from "./picker/QuickAdd.tsx";
import { NodeTooltip, type TipState } from "./NodeTooltip.tsx";
import { CardNode } from "./nodes/CardNode.tsx";
import { FrameNode } from "./nodes/FrameNode.tsx";
import { type ElementFlowNode, FRAME_HANDLE } from "./nodes/types.ts";

const nodeTypes = { card: CardNode, frame: FrameNode };
const edgeTypes = { condition: ConditionEdge };

/** Chakra exposes tokens as CSS variables: `kind.serverAction.solid` → `--chakra-colors-kind-server-action-solid`. */
const cssVar = (token: string) => `var(--chakra-colors-${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replaceAll(".", "-")})`;

/** CSS class (colour, dash shape, speed: canvas.css) and arrow colour of each relation. */
function edgeLook(e: GraphEdge): { className: string; color: string } {
  switch (e.kind) {
    case "imports":
      if (e.importType === "type-only") return { className: "rae-edge rae-edge--imports-type", color: cssVar("relation.importsMuted") };
      if (e.importType === "lazy" || e.importType === "dynamic" || e.importType === "next-dynamic")
        return { className: "rae-edge rae-edge--imports-lazy", color: cssVar("relation.imports") };
      return { className: "rae-edge rae-edge--imports", color: cssVar("relation.imports") };
    case "renders":
      return { className: "rae-edge rae-edge--renders", color: cssVar("kind.component.solid") };
    case "usesHook":
      return { className: "rae-edge rae-edge--usesHook", color: cssVar("kind.hook.solid") };
    case "invokes":
      return { className: "rae-edge rae-edge--invokes", color: cssVar("kind.function.solid") };
    case "invokesAction":
      return { className: "rae-edge rae-edge--invokesAction", color: cssVar("kind.serverAction.solid") };
    case "declares":
      return { className: "rae-edge rae-edge--declares", color: cssVar("kind.module.muted") };
    case "usesType":
      return { className: "rae-edge rae-edge--usesType", color: cssVar("relation.usesType") };
    case "routeFile":
    case "routeChild":
      return { className: "rae-edge rae-edge--routeFile", color: cssVar("relation.routeFile") };
    case "navigates":
      return { className: "rae-edge rae-edge--navigates", color: cssVar("relation.navigates") };
    case "fetches":
      return { className: "rae-edge rae-edge--fetches", color: cssVar("relation.fetches") };
    case "revalidates":
      return { className: "rae-edge rae-edge--revalidates", color: cssVar("relation.revalidates") };
  }
}

const SHORTCUTS: Shortcut[] = [
  { keys: ["Space"], does: "Add to the diagram" },
  { keys: ["⌘ K", "Ctrl K"], does: "Search and add" },
  { keys: ["Right-click"], does: "On the empty canvas, add an element there" },
  { keys: ["Right-click"], does: "On an element, all its actions and relations" },
  { keys: ["Double-click"], does: "Zoom in (also inside a frame)" },
  { keys: ["Drag"], does: "Pan, also inside a file or folder frame" },
  { keys: ["⌘", "Ctrl"], does: "With a click, add to the selection" },
  { keys: ["⌘ A", "Ctrl A"], does: "Select every element on the diagram" },
  { keys: ["Delete", "⌫"], does: "Remove the selected elements" },
  { keys: ["⌘ Z", "Ctrl Z"], does: "Undo a step" },
  { keys: ["⇧ ⌘ Z", "Ctrl Y"], does: "Redo it" },
  { keys: ["Esc"], does: "Clear the selection, close the menu" },
];

const RAISED_Z = 1000;
const FIT = { padding: 0.15, maxZoom: 1, duration: 350 } as const;

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

const isTyping = (t: EventTarget | null) =>
  !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true], [role=dialog], [role=menu]");

interface Holding {
  id: string;
  /** Absolute position of the dragged element's container. */
  origin: { x: number; y: number };
  start: { x: number; y: number };
  /** Frames it may not land in (gathered once: frames don't move during a drag). */
  refusing: CanvasFrame[];
  refused?: string;
}

export function Canvas() {
  const snapshot = useExplorer((s) => s.snapshot);
  const index = useExplorer((s) => s.index);
  const graph = useExplorer((s) => s.graph);
  const placed = useExplorer((s) => s.placed);
  const layoutToken = useExplorer((s) => s.layoutToken);
  const enabled = useExplorer((s) => s.enabled);
  const excluded = useExplorer((s) => s.excluded);
  const hideAllLibraries = useExplorer((s) => s.hideAllLibraries);
  const selection = useExplorer((s) => s.selection);
  const focusId = useExplorer((s) => s.focusId);
  const fitIds = useExplorer((s) => s.fitIds);
  const { select, consumeFocus, applyLayout, dropAt } = useExplorer.getState();
  const flow = useReactFlow();
  const [dragging, setDragging] = useState(false);
  const menu = useExplorer((s) => s.menu);
  const setMenu = useExplorer.getState().openMenu;
  const [tip, setTip] = useState<TipState | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** ⌘/Ctrl held: a click adds to the selection (the cursor says so). */
  const [adding, setAdding] = useState(false);
  /** The dragged element is over a frame that won't take it. */
  const [refusedDrop, setRefusedDrop] = useState(false);

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

  const showAssets = useExplorer((s) => s.showAssets);
  const filter = useMemo(() => relationFilterOf({ enabled, excluded, hideAllLibraries, showAssets }), [enabled, excluded, hideAllLibraries, showAssets]);

  // Scanned elements (files + declarations) under each folder, for folder headers.
  const scannedUnder = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of Object.values(snapshot?.nodes ?? {})) {
      if (n.kind === "external") continue;
      for (let i = n.filePath.lastIndexOf("/"); i > 0; i = n.filePath.lastIndexOf("/", i - 1)) {
        const dir = n.filePath.slice(0, i);
        counts.set(dir, (counts.get(dir) ?? 0) + 1);
      }
    }
    return counts;
  }, [snapshot]);

  const derived = useMemo<ElementFlowNode[]>(() => {
    if (!snapshot || !index) return [];
    const drawn = new Set(placed.map((p) => p.element.id));
    const distinct = (ids: string[]) => new Set(ids).size;
    // A file module's only element is placed automatically (autoPlaceSoleChildren) and can't be
    // dragged; inside folders everything moves freely.
    const held = new Map<string, number>();
    for (const p of placed) if (p.element.parent) held.set(p.element.parent, (held.get(p.element.parent) ?? 0) + 1);
    const kindOf = new Map(placed.map((p) => [p.element.id, p.element.kind]));
    // Nesting depth: deeper elements float higher (bigger shadows), so the diagram reads in layers.
    const parentOf = new Map(placed.map((p) => [p.element.id, p.element.parent]));
    const depthOf = (id: string) => {
      let d = 0;
      for (let p = parentOf.get(id) ?? null; p; p = parentOf.get(p) ?? null) d++;
      return d;
    };
    return placed.map((p) => {
      const id = p.element.id;
      const node = snapshot.nodes[id];
      const parents = node ? parentEdges(snapshot, index, id, filter) : [];
      const children = node ? childEdges(snapshot, index, id, filter) : [];
      return {
        id,
        type: p.holds ? "frame" : "card",
        position: { x: p.x, y: p.y },
        width: p.width,
        height: p.height,
        parentId: p.element.parent ?? undefined,
        dragHandle: p.holds ? `.${FRAME_HANDLE}` : undefined,
        draggable: !(p.element.parent && kindOf.get(p.element.parent) === "module" && held.get(p.element.parent) === 1),
        style: { "--depth": depthOf(id) } as CSSProperties,
        selected: false,
        // React Flow's own selection stays off (it flips its internal node state on click, out of
        // the store's reach); selection is the store's, passed in via `selected`.
        selectable: false,
        data: {
          element: p.element,
          node,
          path: id.startsWith(FOLDER_PREFIX) ? id.slice(FOLDER_PREFIX.length) : undefined,
          scannedCount: id.startsWith(FOLDER_PREFIX) ? scannedUnder.get(id.slice(FOLDER_PREFIX.length)) : undefined,
          parents: distinct(parents.map((e) => e.from)),
          children: distinct(children.map((e) => e.to)),
          hiddenParents: distinct(parents.filter((e) => !drawn.has(e.from)).map((e) => e.from)),
          hiddenChildren: distinct(children.filter((e) => !drawn.has(e.to)).map((e) => e.to)),
          can: node
            ? {
                parents: parents.some((e) => !drawn.has(e.from)),
                allParents: hasUndrawn(snapshot, index, id, "parents", true, filter, drawn),
                children: children.some((e) => !drawn.has(e.to)),
                allChildren: hasUndrawn(snapshot, index, id, "children", true, filter, drawn),
              }
            : id.startsWith(FOLDER_PREFIX)
              ? // folders: "children" = the files inside, "all children" = files and their declarations
                {
                  // parents = the folders above it, up to the project root
                  parents: parentFolders(id, false).some((x) => !drawn.has(x)),
                  allParents: parentFolders(id, true).filter((x) => !drawn.has(x)).length > 1,
                  children: folderExpansion(snapshot, folderPath(id), false).some((x) => !drawn.has(x)),
                  allChildren: folderExpansion(snapshot, folderPath(id), true).some((x) => !drawn.has(x)),
                }
              : { parents: false, allParents: false, children: false, allChildren: false },
          undrawnContents:
            node?.kind === "module" ? (index.out.get(id) ?? []).filter((e) => e.kind === "declares" && !drawn.has(e.to)).length : undefined,
        },
      } as ElementFlowNode;
    });
  }, [snapshot, index, placed, filter, scannedUnder]);

  // What the selection relates to: the other ends of its edges, and its containers / contents.
  const related = useMemo(() => {
    const nodes = new Set<string>();
    const edges = new Set<string>();
    if (!selection.length) return { nodes, edges };
    const sel = new Set(selection);
    for (const r of graph.relations) {
      if (sel.has(r.source) || sel.has(r.target)) {
        edges.add(r.id);
        nodes.add(r.source);
        nodes.add(r.target);
      }
    }
    const parentOf = new Map(graph.elements.map((e) => [e.id, e.parent]));
    const kids = new Map<string, string[]>();
    for (const e of graph.elements) if (e.parent) kids.set(e.parent, [...(kids.get(e.parent) ?? []), e.id]);
    const addInside = (id: string) => {
      for (const k of kids.get(id) ?? []) {
        nodes.add(k);
        addInside(k);
      }
    };
    for (const id of selection) {
      for (let p = parentOf.get(id) ?? null; p; p = parentOf.get(p) ?? null) nodes.add(p);
      // a selected frame (file or folder) highlights everything inside it
      addInside(id);
    }
    for (const id of selection) nodes.delete(id);
    return { nodes, edges };
  }, [selection, graph]);

  // Selection and relatedness are applied on top, so only the nodes involved are re-created.
  const selectedNodes = useMemo(() => {
    if (!selection.length) return derived;
    const sel = new Set(selection);
    return derived.map((n) =>
      sel.has(n.id)
        ? ({ ...n, selected: true } as ElementFlowNode)
        : related.nodes.has(n.id)
          ? ({ ...n, className: "rae-related" } as ElementFlowNode)
          : n,
    );
  }, [derived, selection, related]);

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

  // Dragging: the element is raised over everything; a frame it would be refused by is marked.
  const holding = useRef<Holding | null>(null);
  const patchNode = useCallback(
    (id: string | undefined, patch: (n: ElementFlowNode) => ElementFlowNode) =>
      id && setNodes((ns) => ns.map((n) => (n.id === id ? patch(n) : n))),
    [],
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
      clearTimeout(tipTimer.current);
      setTip(null);
      patchNode(node.id, (n) => ({ ...n, zIndex: RAISED_Z }));
    },
    [patchNode],
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

  const baseEdges = useMemo<ConditionFlowEdge[]>(() => {
    const drawn = new Set(placed.map((p) => p.element.id));
    return graph.relations
      .filter((r) => drawn.has(r.source) && drawn.has(r.target))
      .map(({ id, source, target, edge: e }) => {
        const look = edgeLook(e);
        return {
          id,
          source,
          target,
          type: "condition",
          className: look.className,
          data: { edge: e },
          zIndex: 1,
          markerEnd: { type: MarkerType.ArrowClosed, color: look.color, width: 16, height: 16 },
        };
      });
  }, [graph, placed]);

  const edges = useMemo<ConditionFlowEdge[]>(
    () =>
      related.edges.size
        ? baseEdges.map((e) =>
            related.edges.has(e.id) ? { ...e, className: `${e.className} rae-edge--related`, zIndex: 2, data: { ...e.data!, related: true } } : e,
          )
        : baseEdges,
    [baseEdges, related],
  );

  // Keyboard shortcuts on the diagram (noesis-style).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useExplorer.getState();
      // Esc closes what's open (picker, quick add, menu) — even from inside it — else clears the selection.
      if (e.key === "Escape") {
        if (s.searchOpen || s.quickAdd || s.menu) {
          if (s.searchOpen) s.setSearchOpen(false);
          if (s.quickAdd) s.setQuickAdd(null);
          if (s.menu) setMenu(null);
        } else if (!isTyping(e.target)) s.select(undefined);
        return;
      }
      if (isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (e.key === " " && !mod && !e.repeat && s.snapshot) {
        e.preventDefault();
        s.setSearchOpen(true);
      } else if (mod && key === "a" && !e.altKey) {
        // Every element on the diagram — folders included.
        e.preventDefault();
        s.selectMany(s.placed.map((p) => p.element.id).filter((id) => isFolder(id) || !!s.snapshot?.nodes[id]));
      } else if (mod && !e.altKey && (key === "z" || key === "y")) {
        e.preventDefault();
        if (key === "z" && !e.shiftKey) s.undo();
        else s.redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !mod && s.selection.length) {
        e.preventDefault();
        s.hideNodes(s.selection);
      }
    };
    const onModifier = (e: KeyboardEvent) => setAdding(e.metaKey || e.ctrlKey);
    const onBlur = () => setAdding(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onModifier);
    window.addEventListener("keyup", onModifier);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onModifier);
      window.removeEventListener("keyup", onModifier);
      window.removeEventListener("blur", onBlur);
    };
  }, [flow, setMenu]);

  const menuNode = menu ? snapshot?.nodes[menu.id] : undefined;
  const menuEntries = useMemo(() => (menu ? (menu.mode === "contains" ? containsEntries(menu.id) : nodeMenuEntries(menu.id)) : []), [menu]);

  return (
    <div
      className="rae-canvas"
      tabIndex={-1}
      data-selection={selection.length ? "" : undefined}
      data-dragging={dragging ? "" : undefined}
      data-adding={adding ? "" : undefined}
      data-refused-drop={refusedDrop ? "" : undefined}
      // Pressing on the diagram takes focus from any field, so the diagram's shortcuts apply.
      onPointerDown={(e) => {
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== e.currentTarget && active.matches("input, textarea, select")) e.currentTarget.focus({ preventScroll: true });
      }}
    >
      <ReactFlow<ElementFlowNode, Edge>
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
        // Space adds to the diagram (noesis); panning is a plain drag.
        panActivationKeyCode={null}
        multiSelectionKeyCode={null}
        edgesFocusable={false}
        onNodeClick={(e, n) => {
          // Cards select anywhere; frames (files holding elements, folders) only from their header —
          // where they're dragged. Their room acts as empty canvas (FrameNode: click clears, drag pans).
          const target = e.target as HTMLElement;
          if (target.closest(".rae-icon-btn, .rae-contains")) return;
          if (n.type === "frame" && !target.closest(`.${FRAME_HANDLE}`)) return;
          select(n.id, e.metaKey || e.ctrlKey);
        }}
        onNodeMouseEnter={(e, n) => {
          clearTimeout(tipTimer.current);
          // Folders have no tooltip: their header says what's inside.
          if (!n.data.node) return;
          const el = (e.target as Element).closest(".react-flow__node");
          tipTimer.current = setTimeout(() => {
            if (!el?.isConnected) return;
            const r = el.getBoundingClientRect();
            setTip({ id: n.id, rect: { left: r.left, top: r.top, width: r.width, bottom: r.bottom } });
          }, 600);
        }}
        // A moving view would leave the tooltip behind its node.
        onMoveStart={() => {
          clearTimeout(tipTimer.current);
          setTip(null);
        }}
        onNodeMouseLeave={() => {
          clearTimeout(tipTimer.current);
          setTip(null);
        }}
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
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={() => select(undefined)}
        minZoom={0.05}
        maxZoom={2}
        fitView
        onlyRenderVisibleElements
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={cssVar("canvas.dot")} />
        <Controls position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(n) => {
            const d = (n as ElementFlowNode).data;
            if (d.element.kind === "folder") return "transparent";
            return cssVar(`kind.${d.element.kind}.${n.type === "frame" ? "subtle" : "solid"}`);
          }}
          nodeStrokeColor={(n) => ((n as ElementFlowNode).type === "frame" ? cssVar("kind.module.muted") : "transparent")}
        />
      </ReactFlow>
      {!dragging && !menu && <NodeTooltip tip={tip} snapshot={snapshot} index={index} />}
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
