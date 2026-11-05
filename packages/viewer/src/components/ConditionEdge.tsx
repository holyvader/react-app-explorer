import type { Edge as GraphEdge } from "@rae/schema";
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps, getBezierPath, useInternalNode } from "@xyflow/react";
import { type CSSProperties, memo } from "react";
import { floatingEdgeParams } from "../graph/floating.ts";
import { formatCondition, summarize } from "../lib/conditions.ts";
import { relationWord } from "../lib/relationWords.ts";
import { useLod } from "./lod.ts";

/** `lane` (px) and `step` (its position among them): relations between the same two nodes, side by side. */
export type ConditionEdgeData = { edge: GraphEdge; related?: boolean; lane?: number; step?: number; change?: "added" | "removed" };

/** Labels of side-by-side relations: this far apart, one under another (px). */
const LABEL_STEP = 24;
/**
 * Longest edge whose dashes keep their size (px). A dashed line is painted dash by dash, its whole
 * length each time any of it shows: an edge across a big diagram had thousands, and panning at 1×
 * went from 60 fps to 1 (e2e/bench.ts). Longer edges stretch their pattern (`--ds`, canvas.css)
 * instead. (`pathLength` does the same in Chromium, but WebKit still paints every dash.)
 */
const DASH_LIMIT = 2000;
export type ConditionFlowEdge = Edge<ConditionEdgeData, "condition">;

/**
 * A relation edge, floating (attached where the line between the nodes crosses their borders),
 * labelled with the relation and its render conditions. Colour and dash come from canvas.css.
 */
function ConditionEdgeImpl({ source, target, markerEnd, data }: EdgeProps<ConditionFlowEdge>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  // zoomed out, labels are unreadable: none at all (each is an HTML element of its own)
  const labelled = useLod() === "full";
  if (!sourceNode || !targetNode || !data) return null;
  const { sx, sy, tx, ty, sourcePos, targetPos } = floatingEdgeParams(sourceNode, targetNode, data.lane);
  const edge = data.edge;
  const [path, midX, midY] = getBezierPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, sourcePosition: sourcePos, targetPosition: targetPos });
  // side-by-side relations: their labels stacked one under another, in the lanes' order (the same
  // whichever way each relation points), so they never cover each other
  const labelX = midX;
  const labelY = midY + (data.step ?? 0) * LABEL_STEP;
  const length = Math.hypot(tx - sx, ty - sy);
  const conditions = summarize(edge.conditions, 26);
  const variants = edge.variants?.length ?? 0;
  const title = [
    relationWord(edge) + (edge.specifiers?.length ? `: ${edge.specifiers.join(", ")}` : ""),
    ...(edge.conditions || edge.variants
      ? (edge.variants ?? [edge.conditions ?? []]).map((c) => `when ${c.length ? c.map(formatCondition).join("  ∧  ") : "always"}`)
      : []),
  ].join("\n");
  return (
    <>
      <BaseEdge path={path} markerEnd={labelled ? markerEnd : undefined} style={length > DASH_LIMIT ? ({ "--ds": length / DASH_LIMIT } as CSSProperties) : undefined} />
      {labelled && (
        <EdgeLabelRenderer>
          <div
            className="rae-edge-label nodrag nopan"
            data-kind={edge.kind}
            data-related={data.related || undefined}
            data-change={data.change}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title={title}
          >
            <b>
              {data.change === "added" ? "+ " : data.change === "removed" ? "− " : ""}
              {relationWord(edge)}
              {variants > 1 ? ` (+${variants - 1})` : ""}
            </b>
            {conditions && <span className="rae-edge-label__when"> when {conditions}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const ConditionEdge = memo(ConditionEdgeImpl);
