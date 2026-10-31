import { Handle, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { KIND_META } from "../../lib/kinds.tsx";
import { CardShape } from "./CardShape.tsx";
import { ContainsButton, NodeActions } from "./NodeActions.tsx";
import { type CardFlowNode, HIDDEN_HANDLE } from "./types.ts";

/**
 * A single element, its shape telling its kind: component (rounded rectangle), hook (hexagon),
 * function (solid pill), server action (arrow), file module (folded sheet), library (dashed pill).
 * Plain HTML + canvas.css: it re-renders on every drag frame.
 */
function CardNodeImpl({ data, width, height }: NodeProps<CardFlowNode>) {
  const { node, element } = data;
  if (!node) return null;
  const Icon = KIND_META[node.kind].icon;
  return (
    <div className="rae-card" data-kind={node.kind}>
      <Handle type="target" position={Position.Top} isConnectable={false} style={HIDDEN_HANDLE} />
      <CardShape kind={node.kind} width={width ?? 0} height={height ?? 0} />
      <div className="rae-card__body">
        <div className="rae-row">
          <span className="rae-icon">
            <Icon size={14} />
          </span>
          <span className="rae-name">{element.name}</span>
          <span className="rae-spacer" />
          {node.moduleType && element.parent === null && <span className="rae-chip" data-boundary={node.moduleType}>{node.moduleType}</span>}
        </div>
        <div className="rae-row">
          <span className="rae-badges">
            <span className="rae-badge">{KIND_META[node.kind].label}</span>
            {node.nextRole && <span className="rae-badge rae-badge--outline">{node.nextRole}</span>}
            {node.isAsync && <span className="rae-badge rae-badge--outline">async</span>}
          </span>
          <NodeActions data={data} />
        </div>
      </div>
      <ContainsButton data={data} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={HIDDEN_HANDLE} />
    </div>
  );
}

export const CardNode = memo(CardNodeImpl);
