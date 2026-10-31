import type { Edge as GraphEdge } from "@rae/schema";
import { Box } from "@rae/design-system";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FOLDER_PREFIX } from "../graph/drawn.ts";
import { layoutAll } from "../graph/layout.ts";
import { absoluteRect, type CanvasFrame, landsIn, refusingFrames } from "../graph/placement.ts";
import { childEdges, parentEdges } from "../graph/relations.ts";
import { relationFilterOf, useExplorer } from "../store.ts";
import { ConditionEdge, type ConditionFlowEdge } from "./ConditionEdge.tsx";
import { CardNode } from "./nodes/CardNode.tsx";
import { FrameNode } from "./nodes/FrameNode.tsx";
import { type ElementFlowNode, FRAME_HANDLE } from "./nodes/types.ts";

const nodeTypes = { card: CardNode, frame: FrameNode };
const edgeTypes = { condition: ConditionEdge };

const cssVar = (token: string) => `var(--chakra-colors-${token.replaceAll(".", "-")})`;

const EDGE_STYLE: Record<GraphEdge["kind"], { color: string; dash?: string; width?: number }> = {
  imports: { color: cssVar("kind.module.solid") },
  declares: { color: cssVar("kind.module.muted"), dash: "2 4" },
  renders: { color: cssVar("kind.component.solid"), width: 1.75 },
  usesHook: { color: cssVar("kind.hook.solid") },
  invokes: { color: cssVar("kind.function.solid") },
  invokesAction: { color: cssVar("kind.serverAction.solid"), width: 1.75 },
};

const RAISED_Z = 1000;

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
const FIT = { padding: 0.15, maxZoom: 1, duration: 350 } as const;

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
  const selectedId = useExplorer((s) => s.selectedId);
  const focusId = useExplorer((s) => s.focusId);
  const fitIds = useExplorer((s) => s.fitIds);
  const { select, consumeFocus, applyLayout, dropAt } = useExplorer.getState();
  const flow = useReactFlow();
  const [dragging, setDragging] = useState(false);

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

  const filter = useMemo(() => relationFilterOf({ enabled, excluded, hideAllLibraries }), [enabled, excluded, hideAllLibraries]);

  const derived = useMemo<ElementFlowNode[]>(() => {
    if (!snapshot || !index) return [];
    const drawn = new Set(placed.map((p) => p.element.id));
    const distinct = (ids: string[]) => new Set(ids).size;
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
        selected: false,
        selectable: !!node,
        data: {
          element: p.element,
          node,
          path: id.startsWith(FOLDER_PREFIX) ? id.slice(FOLDER_PREFIX.length) : undefined,
          parents: distinct(parents.map((e) => e.from)),
          children: distinct(children.map((e) => e.to)),
          hiddenParents: distinct(parents.filter((e) => !drawn.has(e.from)).map((e) => e.from)),
          hiddenChildren: distinct(children.filter((e) => !drawn.has(e.to)).map((e) => e.to)),
        },
      } as ElementFlowNode;
    });
  }, [snapshot, index, placed, filter]);

  // Selection is applied on top, so selecting re-creates only the two nodes involved.
  const selectedNodes = useMemo(
    () => derived.map((n) => (n.id === selectedId ? ({ ...n, selected: true } as ElementFlowNode) : n)),
    [derived, selectedId],
  );

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

  const onNodesChange = useCallback(
    (changes: NodeChange<ElementFlowNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );

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
    },
    [markRefused],
  );

  const onNodeDragStop = useCallback<OnNodeDrag<ElementFlowNode>>(
    (_, node) => {
      const h = holding.current;
      holding.current = null;
      setDragging(false);
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

  const edges = useMemo<ConditionFlowEdge[]>(() => {
    const drawn = new Set(placed.map((p) => p.element.id));
    return graph.relations
      .filter((r) => drawn.has(r.source) && drawn.has(r.target))
      .map(({ id, source, target, edge: e }) => {
        const st = EDGE_STYLE[e.kind];
        const lazy = e.importType === "lazy" || e.importType === "dynamic" || e.importType === "next-dynamic";
        const typeOnly = e.importType === "type-only";
        return {
          id,
          source,
          target,
          type: "condition",
          data: { edge: e },
          animated: e.kind === "invokesAction",
          zIndex: 1,
          markerEnd: { type: MarkerType.ArrowClosed, color: st.color, width: 16, height: 16 },
          style: {
            stroke: st.color,
            strokeWidth: st.width ?? 1.25,
            strokeDasharray: lazy ? "6 4" : typeOnly ? "1 4" : st.dash,
            opacity: typeOnly ? 0.6 : 1,
          },
        };
      });
  }, [graph, placed]);

  return (
    <Box
      h="full"
      w="full"
      // Elements glide to a new placement — never while dragging, or a frame's content would trail.
      css={dragging ? undefined : { "& .react-flow__node": { transition: "transform 240ms ease, width 240ms ease, height 240ms ease" } }}
    >
      <ReactFlow<ElementFlowNode, Edge>
        nodes={nodes}
        edges={edges as Edge[]}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        // Read-only diagram: no drawing connections, no React Flow deletion (Delete is handled by the app).
        nodesConnectable={false}
        deleteKeyCode={null}
        edgesFocusable={false}
        onNodeClick={(_, n) => n.data.node && select(n.id)}
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
    </Box>
  );
}
