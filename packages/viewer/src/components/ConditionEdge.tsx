import type { Edge as GraphEdge } from "@rae/schema";
import { Box } from "@rae/design-system";
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps, getBezierPath } from "@xyflow/react";
import { formatCondition, summarize } from "../lib/conditions.ts";

export type ConditionEdgeData = { edge: GraphEdge };
export type ConditionFlowEdge = Edge<ConditionEdgeData, "condition">;

export function ConditionEdge(props: EdgeProps<ConditionFlowEdge>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data } = props;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const edge = data?.edge;
  const label = summarize(edge?.conditions);
  const variants = edge?.variants?.length ?? 0;

  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      {label && edge && (
        <EdgeLabelRenderer>
          <Box
            position="absolute"
            transform={`translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`}
            pointerEvents="all"
            className="nodrag nopan"
          >
              <Box
                title={(edge.variants ?? [edge.conditions ?? []]).map((conds) => (conds.length ? conds.map(formatCondition).join("  ∧  ") : "always")).join("\n")}
                bg="bg.panel"
                borderWidth="1px"
                borderColor="kind.component.muted"
                rounded="sm"
                px="1.5"
                fontSize="2xs"
                fontFamily="mono"
                color="fg.muted"
                maxW="220px"
                truncate
              >
                {label}
                {variants > 1 ? ` (+${variants - 1})` : ""}
              </Box>
          </Box>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
