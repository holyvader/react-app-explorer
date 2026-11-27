import type { Edge as GraphEdge } from "@rae/schema";
import { BaseEdge, type Edge, type EdgeProps, getBezierPath, Position, useInternalNode } from "@xyflow/react";
import { type CSSProperties, memo } from "react";
import { type EdgeEnd, floatingEdgeParams } from "../graph/floating.ts";
import { formatCondition, summarize } from "../lib/conditions.ts";
import { relationWord } from "../lib/relationWords.ts";
import { useLod } from "./lod.ts";
import { EdgeLabel } from "./canvas/edgeLabels.tsx";

/** `lane` (px) and `step` (its position among them): relations between the same two nodes, side by side. */
export type ConditionEdgeData = {
  edge: GraphEdge;
  related?: boolean;
  lane?: number;
  step?: number;
  change?: "added" | "removed";
  /** Zoomed out: the relations this edge stands for, between collapsed frames (graph/collapse.ts). */
  bundle?: string[];
};

/** How far the line runs on into a row or a file's header past its port, to its arrowhead (px). */
const STUB = 10;

/**
 * Where an edge meets a file, a mark on the border says what it's attached to: a dot for a row (a
 * declaration inside the file), a square on the header for the file itself.
 */
function Port({ x, y, end }: { x: number; y: number; end: EdgeEnd }) {
  if (end === "row") return <circle className="rae-edge-port" cx={x} cy={y} r={4} />;
  if (end === "file") return <rect className="rae-edge-port" x={x - 4} y={y - 4} width={8} height={8} rx={1} />;
  return null;
}

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
/** Long edges stretch their dashes; a merged edge is thicker the more it stands for (1px → 6px). */
function strokeStyle(length: number, merged = 0): CSSProperties | undefined {
  if (length <= DASH_LIMIT && merged < 2) return undefined;
  return {
    ...(length > DASH_LIMIT ? { "--ds": length / DASH_LIMIT } : {}),
    ...(merged > 1 ? { "--ew": `${Math.min(6, 1 + Math.log2(merged))}px` } : {}),
  } as CSSProperties;
}

function ConditionEdgeImpl({ source, target, markerEnd, data }: EdgeProps<ConditionFlowEdge>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  // zoomed out, labels are unreadable: none at all (each is an HTML element of its own)
  const labelled = useLod() === "full";
  if (!sourceNode || !targetNode || !data) return null;
  const { sx, sy, tx, ty, sourcePos, targetPos, sourceEnd, targetEnd } = floatingEdgeParams(sourceNode, targetNode, data.lane);
  const edge = data.edge;
  const [curve, midX, midY] = getBezierPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, sourcePosition: sourcePos, targetPosition: targetPos });
  // into a file (a row, or its header): on past the border a little, the arrowhead inside
  const into = labelled && targetEnd ? (targetPos === Position.Left ? STUB : targetPos === Position.Right ? -STUB : 0) : 0;
  const path = into ? `${curve} L${tx + into},${ty}` : curve;
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
      <BaseEdge path={path} markerEnd={labelled ? markerEnd : undefined} style={strokeStyle(length, data.bundle?.length)} />
      {labelled && <Port x={sx} y={sy} end={sourceEnd} />}
      {labelled && <Port x={tx} y={ty} end={targetEnd} />}
      {labelled && (
        <EdgeLabel>
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
        </EdgeLabel>
      )}
    </>
  );
}

export const ConditionEdge = memo(ConditionEdgeImpl);
