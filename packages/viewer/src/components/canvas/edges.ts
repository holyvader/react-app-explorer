import type { Edge as GraphEdge } from "@rae/schema";
import { tokenVar } from "@rae/design-system";
import { MarkerType } from "@xyflow/react";
import { useMemo } from "react";
import { bundleRelations, type Collapse } from "../../graph/collapse.ts";
import type { DrawnGraph } from "../../graph/drawn.ts";
import type { PlacedElement } from "../../graph/layout.ts";
import { edgeChange } from "../../lib/diff.ts";
import type { ConditionFlowEdge } from "../ConditionEdge.tsx";
import type { Lod } from "../lod.ts";
import type { Related } from "./nodes.ts";

/*
 * The canvas's edges, in three memoized steps so each change re-creates only what it must: the drawn
 * relations (colour, dash, lanes, diff marks) → bundled per block pair under a collapse → the
 * selection's edges marked (or, far out on a big diagram, the only ones drawn).
 */

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

export function useCanvasEdges({ graph, placed, showDiff, collapse, related, lod }: { graph: DrawnGraph; placed: PlacedElement[]; showDiff: boolean; collapse: Collapse; related: Related; lod: Lod }): ConditionFlowEdge[] {
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
  return edges;
}
