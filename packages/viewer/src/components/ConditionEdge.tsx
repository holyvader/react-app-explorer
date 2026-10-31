import type { Edge as GraphEdge } from "@rae/schema";
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps, getBezierPath } from "@xyflow/react";
import { memo } from "react";
import { formatCondition, summarize } from "../lib/conditions.ts";

export type ConditionEdgeData = { edge: GraphEdge; related?: boolean };
export type ConditionFlowEdge = Edge<ConditionEdgeData, "condition">;

/** Relation edge; render conditions as a label. Styling (colour, dash, speed) comes from canvas.css by kind. */
function ConditionEdgeImpl(props: EdgeProps<ConditionFlowEdge>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data } = props;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const edge = data?.edge;
  const label = summarize(edge?.conditions);
  const variants = edge?.variants?.length ?? 0;
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} />
      {label && edge && (
        <EdgeLabelRenderer>
          <div
            className="rae-edge-label nodrag nopan"
            data-related={data?.related || undefined}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title={(edge.variants ?? [edge.conditions ?? []]).map((c) => (c.length ? c.map(formatCondition).join("  ∧  ") : "always")).join("\n")}
          >
            {label}
            {variants > 1 ? ` (+${variants - 1})` : ""}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const ConditionEdge = memo(ConditionEdgeImpl);
