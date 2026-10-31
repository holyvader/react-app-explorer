import { Handle, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { KIND_META } from "../../lib/kinds.tsx";
import { NodeActions } from "./NodeActions.tsx";
import { type CardFlowNode, HIDDEN_HANDLE } from "./types.ts";

/**
 * A single element, its shape telling its kind: component (rounded), hook (hexagon), function
 * (chamfered), server action (arrow), file module (folded sheet), library (dashed pill).
 * Plain HTML + canvas.css: it re-renders on every drag frame.
 */
function CardNodeImpl({ data }: NodeProps<CardFlowNode>) {
  const { node, element } = data;
  if (!node) return null;
  const Icon = KIND_META[node.kind].icon;
  return (
    <div className="rae-card" data-kind={node.kind} title={node.filePath}>
      <Handle type="target" position={Position.Top} isConnectable={false} style={HIDDEN_HANDLE} />
      <div className="rae-card__shape" />
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
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={HIDDEN_HANDLE} />
    </div>
  );
}

export const CardNode = memo(CardNodeImpl);
