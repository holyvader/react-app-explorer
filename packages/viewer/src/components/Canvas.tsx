import type { Edge as GraphEdge, GraphNode } from "@rae/schema";
import { ContextMenu, SegmentedToggles, ShortcutLegend, type Shortcut, type ToggleItem, tokenVar, useColorMode } from "@rae/design-system";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  type NodeChange,
  Panel as FlowPanel,
  type OnNodeDrag,
  ReactFlow,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FOLDER_PREFIX, isFolder, routeChain, routeOf } from "../graph/drawn.ts";
import { bundleRelations, collapseFrames } from "../graph/collapse.ts";
import { folderExpansion, folderPath, parentFolders } from "../graph/folder.ts";
import { layoutAll } from "../graph/layout.ts";
import { absoluteRect, type CanvasFrame, landsIn, refusingFrames } from "../graph/placement.ts";
import { childEdges, EDGE_GROUPS, type EdgeGroup, hasUndrawn, parentEdges } from "../graph/relations.ts";
import { IconBack, IconForward } from "@rae/design-system/icons";
import { changeOf, edgeChange } from "../lib/diff.ts";
import { KIND_META } from "../lib/kinds.tsx";
import { goBack, goForward, useSelectionHistory } from "../lib/selectionHistory.ts";
import { useExplorer, useRelationFilter } from "../store.ts";
import "./canvas.css";
import { ConditionEdge, type ConditionFlowEdge } from "./ConditionEdge.tsx";
import { NodeDiffModal } from "./NodeDiffModal.tsx";
import { collapseLevelOf, type Lod, LodContext, lodOf, nextLod } from "./lod.ts";
import { containsEntries, nodeMenuEntries } from "./nodeMenu.tsx";
import { ExplorationPicker } from "./picker/ExplorationPicker.tsx";
import { QuickAdd } from "./picker/QuickAdd.tsx";
import { NodeTooltip, type TipState } from "./NodeTooltip.tsx";
import { CardNode } from "./nodes/CardNode.tsx";
import { FrameNode } from "./nodes/FrameNode.tsx";
import { type ElementFlowNode, FRAME_HANDLE } from "./nodes/types.ts";

const nodeTypes = { card: CardNode, frame: FrameNode };
const edgeTypes = { condition: ConditionEdge };

/** CSS class (colour, dash shape, speed: canvas.css) and arrow colour of each relation. */
function edgeLook(e: GraphEdge): { className: string; color: string } {
  switch (e.kind) {
    case "imports":
      if (e.importType === "type-only") return { className: "rae-edge rae-edge--imports-type", color: tokenVar("relation.importsMuted") };
      if (e.importType === "lazy" || e.importType === "dynamic" || e.importType === "next-dynamic")
        return { className: "rae-edge rae-edge--imports-lazy", color: tokenVar("relation.imports") };
      return { className: "rae-edge rae-edge--imports", color: tokenVar("relation.imports") };
    case "renders":
      return { className: "rae-edge rae-edge--renders", color: tokenVar("relation.renders") };
    case "usesHook":
      return { className: "rae-edge rae-edge--usesHook", color: tokenVar("relation.usesHook") };
    case "invokes":
      return { className: "rae-edge rae-edge--invokes", color: tokenVar("relation.invokes") };
    case "invokesAction":
      return { className: "rae-edge rae-edge--invokesAction", color: tokenVar("relation.invokesAction") };
    case "declares":
      return { className: "rae-edge rae-edge--declares", color: tokenVar("relation.declares") };
    case "usesType":
      return { className: "rae-edge rae-edge--usesType", color: tokenVar("relation.usesType") };
    case "routeFile":
    case "routeChild":
      return { className: "rae-edge rae-edge--routeFile", color: tokenVar("relation.routeFile") };
    case "navigates":
      return { className: "rae-edge rae-edge--navigates", color: tokenVar("relation.navigates") };
    case "fetches":
      return { className: "rae-edge rae-edge--fetches", color: tokenVar("relation.fetches") };
    case "revalidates":
      return { className: "rae-edge rae-edge--revalidates", color: tokenVar("relation.revalidates") };
    case "runsBefore":
      return { className: "rae-edge rae-edge--runsBefore", color: tokenVar("relation.runsBefore") };
    case "invalidates":
      return { className: "rae-edge rae-edge--invalidates", color: tokenVar("relation.invalidates") };
  }
}

/** Room (px) between relations drawn side by side between the same two nodes. */
const EDGE_LANE = 10;

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

const RAISED_Z = 1000;
/** How long a tooltip stays after the pointer leaves its node: time to reach it (and keep it open). */
const TIP_GRACE = 250;
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
  const selection = useExplorer((s) => s.selection);
  const focusId = useExplorer((s) => s.focusId);
  const fitIds = useExplorer((s) => s.fitIds);
  const { select, consumeFocus, applyLayout, dropAt } = useExplorer.getState();
  const flow = useReactFlow();
  // the level of detail: a bucket of the zoom (with some hysteresis), so this re-renders only when it changes
  const lodRef = useRef<Lod | null>(null);
  const lod = useStore((s) => (lodRef.current = lodRef.current ? nextLod(s.transform[2], lodRef.current) : lodOf(s.transform[2])));
  const [dragging, setDragging] = useState(false);
  const menu = useExplorer((s) => s.menu);
  const setMenu = useExplorer.getState().openMenu;
  const [tip, setTip] = useState<TipState | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // the tooltip's grace time after its node is left (apart from showing: crossing a frame on the way keeps it)
  const tipHide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // the diff view's code: the hovered element's changed lines in the tooltip, and its code diff dialog
  const diffCode = useExplorer((s) => s.diffOverlay && s.diffCode);
  const [diffOf, setDiffOf] = useState<GraphNode | null>(null);
  /** ⌘ / Ctrl / Shift held: a click adds to the selection (the cursor says so). */
  const [adding, setAdding] = useState(false);
  /** Shift held: a drag on empty space draws a selection box (crosshair). */
  const [boxing, setBoxing] = useState(false);
  /** The dragged element is over a frame that won't take it. */
  const [refusedDrop, setRefusedDrop] = useState(false);
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

  const diffOverlay = useExplorer((s) => s.diffOverlay);
  const filter = useRelationFilter();
  // diff snapshots, overlay on: what changed is marked
  const showDiff = !!snapshot?.diff && diffOverlay;

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
                routeChain: (() => {
                  const route = routeOf(snapshot, id);
                  return !!route && routeChain(snapshot, route).some((x) => !drawn.has(x));
                })(),
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
          change: showDiff ? changeOf(snapshot, id) : undefined,
          undrawnContents:
            node?.kind === "module" ? (index.out.get(id) ?? []).filter((e) => e.kind === "declares" && !drawn.has(e.to)).length : undefined,
        },
      } as ElementFlowNode;
    });
  }, [snapshot, index, placed, filter, scannedUnder, showDiff]);

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

  // Zoomed far out, frames are blocks: what's inside is hidden (React Flow keeps the nodes and their
  // measurements), the frame says how many it holds. Only the nodes involved are re-created.
  const collapse = useMemo(() => collapseFrames(placed, collapseLevelOf(lod, placed.length)), [placed, lod]);
  const shownNodes = useMemo(() => {
    if (!collapse.frames.size) return derived;
    return derived.map((n) => {
      if (collapse.shownAs.has(n.id)) return { ...n, hidden: true } as ElementFlowNode;
      const count = collapse.frames.get(n.id);
      return count ? ({ ...n, data: { ...n.data, collapsed: count } } as ElementFlowNode) : n;
    });
  }, [derived, collapse]);

  // Selection and relatedness are applied on top, so only the nodes involved are re-created. What's
  // hidden in a collapsed frame shows as the frame: it's marked related.
  const selectedNodes = useMemo(() => {
    if (!selection.length) return shownNodes;
    const sel = new Set(selection);
    const block = (id: string) => collapse.shownAs.get(id);
    const marked = new Set([...selection, ...related.nodes].map(block).filter((id): id is string => !!id));
    return shownNodes.map((n) =>
      sel.has(n.id)
        ? ({ ...n, selected: true } as ElementFlowNode)
        : related.nodes.has(n.id) || marked.has(n.id)
          ? ({ ...n, className: "rae-related" } as ElementFlowNode)
          : n,
    );
  }, [shownNodes, selection, related, collapse]);

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
    const shown = graph.relations.filter((r) => drawn.has(r.source) && drawn.has(r.target));
    // several relations between the same two nodes (either way) run side by side, in lanes
    const pairs = new Map<string, string[]>();
    for (const r of shown) {
      const key = r.source < r.target ? `${r.source}\n${r.target}` : `${r.target}\n${r.source}`;
      pairs.set(key, [...(pairs.get(key) ?? []), r.id]);
    }
    const laneOf = new Map<string, { lane: number; step: number }>();
    for (const ids of pairs.values()) ids.forEach((id, i) => laneOf.set(id, { lane: (i - (ids.length - 1) / 2) * EDGE_LANE, step: i - (ids.length - 1) / 2 }));
    return shown
      .map(({ id, source, target, edge: e }) => {
        const look = edgeLook(e);
        const change = showDiff ? edgeChange(e) : undefined;
        return {
          id,
          source,
          target,
          type: "condition",
          className: change ? `${look.className} rae-edge--${change}` : look.className,
          data: { edge: e, change, ...laneOf.get(id) },
          zIndex: 1,
          markerEnd: { type: MarkerType.ArrowClosed, color: change ? tokenVar(`diff.${change}.solid`) : look.color, width: 12, height: 12 },
        };
      });
  }, [graph, placed, showDiff]);

  // Under a collapse, relations into a block connect the block, one edge per block pair (thicker
  // for more), in the relation's colour when they're all one kind.
  const shownEdges = useMemo<ConditionFlowEdge[]>(() => {
    const { kept, bundles } = bundleRelations(baseEdges, collapse);
    if (!bundles.length) return kept;
    return [
      ...kept,
      ...bundles.map(({ source, target, members }) => {
        const look = members.every((m) => m.className === members[0].className) ? members[0].className : "rae-edge rae-edge--imports";
        return {
          id: `bundle:${source}>${target}`,
          source,
          target,
          type: "condition" as const,
          className: `${look} rae-edge--bundle`,
          data: { edge: members[0].data!.edge, bundle: members.map((m) => m.id) },
          zIndex: 1,
        };
      }),
    ];
  }, [baseEdges, collapse]);

  // Far out (a big diagram's whole map), only the selection's edges: thousands of lines across the
  // map read as nothing, and cost the most to draw.
  const mapOnly = lod === "far" && collapse.frames.size > 0;
  const edges = useMemo<ConditionFlowEdge[]>(() => {
    const isRelated = (e: ConditionFlowEdge) => related.edges.has(e.id) || !!e.data?.bundle?.some((id) => related.edges.has(id));
    const mark = (e: ConditionFlowEdge) => ({ ...e, className: `${e.className} rae-edge--related`, zIndex: 2, data: { ...e.data!, related: true } });
    if (mapOnly) return shownEdges.filter(isRelated).map(mark);
    return related.edges.size ? shownEdges.map((e) => (isRelated(e) ? mark(e) : e)) : shownEdges;
  }, [shownEdges, related, mapOnly]);

  // Keyboard shortcuts on the diagram.
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
    const onModifier = (e: KeyboardEvent) => {
      setAdding(e.metaKey || e.ctrlKey || e.shiftKey);
      setBoxing(e.shiftKey);
    };
    const onBlur = () => {
      setAdding(false);
      setBoxing(false);
    };
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

  const colorMode = useColorMode();
  const menuNode = menu ? snapshot?.nodes[menu.id] : undefined;
  const menuEntries = useMemo(() => (menu ? (menu.mode === "contains" ? containsEntries(menu.id) : nodeMenuEntries(menu.id)) : []), [menu]);

  return (
    <div
      className="rae-canvas"
      tabIndex={-1}
      data-selection={selection.length ? "" : undefined}
      data-lod={lod}
      data-dragging={dragging ? "" : undefined}
      data-adding={adding ? "" : undefined}
      data-boxing={boxing ? "" : undefined}
      data-refused-drop={refusedDrop ? "" : undefined}
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
          onNodeMouseEnter={(e, n) => {
            clearTimeout(tipTimer.current);
            // back on the node whose tooltip is open: it stays (another node's leaves when its grace is over)
            setTip((t) => {
              if (t?.id === n.id) clearTimeout(tipHide.current);
              return t;
            });
            // Folders have no tooltip: their header says what's inside.
            if (!n.data.node) return;
            const el = (e.target as Element).closest(".react-flow__node");
            tipTimer.current = setTimeout(() => {
              if (!el?.isConnected) return;
              const r = el.getBoundingClientRect();
              clearTimeout(tipHide.current);
              setTip({ id: n.id, rect: { left: r.left, top: r.top, width: r.width, bottom: r.bottom } });
            }, 600);
          }}
          // A moving view would leave the tooltip behind its node.
          onMoveStart={() => {
            clearTimeout(tipTimer.current);
            setTip(null);
          }}
          // a moment to reach the tooltip: the pointer on it keeps it open
          onNodeMouseLeave={(e) => {
            clearTimeout(tipTimer.current);
            // onto the tooltip (from its node, or from the frame around it, crossed on the way): it stays
            if ((e.relatedTarget as Element | null)?.closest?.(".rae-tip")) return;
            clearTimeout(tipHide.current);
            tipHide.current = setTimeout(() => setTip(null), TIP_GRACE);
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
      {!dragging && !menu && !diffOf && (
        <NodeTooltip
          tip={tip && placed.some((p) => p.element.id === tip.id) ? tip : null}
          snapshot={snapshot}
          index={index}
          diffCode={diffCode}
          onOpenDiff={(n) => {
            setTip(null);
            setDiffOf(n);
          }}
          onPointerEnter={() => {
            clearTimeout(tipTimer.current);
            clearTimeout(tipHide.current);
          }}
          onPointerLeave={() => {
            clearTimeout(tipTimer.current);
            clearTimeout(tipHide.current);
            setTip(null);
          }}
        />
      )}
      {diffOf && snapshot && <NodeDiffModal node={diffOf} snapshot={snapshot} open onOpenChange={(open) => !open && setDiffOf(null)} />}
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

/** How far the pointer moves before a ⌘/Ctrl press becomes a selection box (px). */
const MARQUEE_SLOP = 4;

/**
 * Shift + drag from empty space (the pane, or a frame's room) draws a selection box (React Flow's
 * own default): what it touches joins the selection, live, on top of what was selected before.
 * Cards count when touched; frames only when wholly inside (a box drawn in a frame's room isn't
 * picking the frame). The selection on release is exactly what was highlighted. A press that
 * doesn't move does nothing.
 */
function useMarquee() {
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

/** Each relation filter's swatch: the same colour as its edges, a shape as the second cue. */
const GROUP_LOOK: Record<EdgeGroup, Pick<ToggleItem, "color" | "shape">> = {
  imports: { color: "relation.imports" },
  declares: { color: "relation.declares" },
  renders: { color: "relation.renders" },
  hooks: { color: "relation.usesHook", shape: "circle" },
  invokes: { color: "relation.invokes" },
  types: { color: "relation.usesType" },
  navigation: { color: "relation.navigates" },
  cache: { color: "relation.invalidates", shape: "diamond" },
};

/** Which relations the diagram draws, on the canvas's top-left corner. */
function RelationFilters() {
  const enabled = useExplorer((s) => s.enabled);
  return (
    <SegmentedToggles
      label="Relations"
      title="Relations"
      items={EDGE_GROUPS.map(({ group, label }) => ({ value: group, label: label.toLowerCase(), ...GROUP_LOOK[group], on: enabled[group] }))}
      onToggle={(g) => useExplorer.getState().toggleGroup(g as EdgeGroup)}
    />
  );
}

/** Back / Forward through the selected elements (the desktop app has no browser buttons). */
function HistoryButtons() {
  const { canBack, canForward } = useSelectionHistory();
  return (
    <div className="react-flow__controls rae-history__group">
      <ControlButton onClick={goBack} disabled={!canBack} title="Back: the previously selected element (⌘ [)" aria-label="Back to the previously selected element">
        <IconBack size={14} />
      </ControlButton>
      <ControlButton onClick={goForward} disabled={!canForward} title="Forward (⌘ ])" aria-label="Forward to the next selected element">
        <IconForward size={14} />
      </ControlButton>
    </div>
  );
}
