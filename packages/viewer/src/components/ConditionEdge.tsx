import type { Edge as GraphEdge } from "@rae/schema";
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps, getBezierPath, useInternalNode } from "@xyflow/react";
import { memo } from "react";
import { floatingEdgeParams } from "../graph/floating.ts";
import { formatCondition, summarize } from "../lib/conditions.ts";
import { relationWord } from "../lib/relationWords.ts";

export type ConditionEdgeData = { edge: GraphEdge; related?: boolean };
export type ConditionFlowEdge = Edge<ConditionEdgeData, "condition">;

/**
 * A relation edge, floating (attached where the line between the nodes crosses their borders),
 * labelled with the relation and its render conditions. Colour, dash and speed come from canvas.css.
 */
function ConditionEdgeImpl({ source, target, markerEnd, data }: EdgeProps<ConditionFlowEdge>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode || !data) return null;
  const { sx, sy, tx, ty, sourcePos, targetPos } = floatingEdgeParams(sourceNode, targetNode);
  const edge = data.edge;
  const [path, labelX, labelY] = getBezierPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, sourcePosition: sourcePos, targetPosition: targetPos });
  const conditions = summarize(edge.conditions, 34);
  const variants = edge.variants?.length ?? 0;
  const title = [
    relationWord(edge) + (edge.specifiers?.length ? `: ${edge.specifiers.join(", ")}` : ""),
    ...(edge.conditions || edge.variants
      ? (edge.variants ?? [edge.conditions ?? []]).map((c) => `when ${c.length ? c.map(formatCondition).join("  ∧  ") : "always"}`)
      : []),
  ].join("\n");
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div
          className="rae-edge-label nodrag nopan"
          data-kind={edge.kind}
          data-related={data.related || undefined}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          title={title}
        >
          <b>{relationWord(edge)}</b>
          {conditions && <span className="rae-edge-label__when"> · {conditions}</span>}
          {variants > 1 ? ` (+${variants - 1})` : ""}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const ConditionEdge = memo(ConditionEdgeImpl);
