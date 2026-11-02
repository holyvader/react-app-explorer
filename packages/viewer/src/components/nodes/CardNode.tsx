import { IconFolder } from "@rae/design-system/icons";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { KIND_META, fileNote, routeCaption } from "../../lib/kinds.tsx";
import { CardShape } from "./CardShape.tsx";
import { ContainsButton, NodeActions } from "./NodeActions.tsx";
import { type CardFlowNode, HIDDEN_HANDLE } from "./types.ts";

/**
 * A single element, its shape telling its kind: component (rounded rectangle), hook (hexagon),
 * function (solid pill), server action (arrow), file module (folded sheet), library (dashed pill).
 * Icon tile + name + quiet caption; actions float in on hover / selection.
 * Plain HTML + canvas.css: it re-renders on every drag frame.
 */
function CardNodeImpl({ data, width, height }: NodeProps<CardFlowNode>) {
  const { node, element } = data;
  // An added folder with nothing drawn inside yet: a dashed folder card.
  if (element.kind === "folder") {
    return (
      <div className="rae-card" data-kind="folder">
        <Handle type="target" position={Position.Top} isConnectable={false} style={HIDDEN_HANDLE} />
        <CardShape kind="folder" width={width ?? 0} height={height ?? 0} />
        <div className="rae-card__body">
          <span className="rae-card__tile" aria-hidden>
            <IconFolder size={16} strokeWidth={2.2} />
          </span>
          <div className="rae-card__text">
            <div className="rae-name">{element.name}</div>
            <div className="rae-card__caption">Folder{data.scannedCount !== undefined ? ` · ${data.scannedCount} scanned elements` : ""}</div>
          </div>
        </div>
        <div className="rae-card__actions">
          <NodeActions data={data} />
        </div>
        <Handle type="source" position={Position.Bottom} isConnectable={false} style={HIDDEN_HANDLE} />
      </div>
    );
  }
  if (!node) return null;
  const meta = KIND_META[node.kind];
  const Icon = meta.icon;
  const caption = node.route ? routeCaption(node.route) : [node.kind === "type" && node.typeKind && node.typeKind !== "type" ? node.typeKind[0]!.toUpperCase() + node.typeKind.slice(1) : meta.label, fileNote(node), node.nextRole, node.isAsync ? "async" : undefined].filter(Boolean).join(" · ");
  return (
    <div className="rae-card" data-kind={node.kind} data-missing={node.missing || undefined}>
      <Handle type="target" position={Position.Top} isConnectable={false} style={HIDDEN_HANDLE} />
      <CardShape kind={node.kind} width={width ?? 0} height={height ?? 0} dashed={node.missing} />
      <div className="rae-card__body">
        <span className="rae-card__tile" aria-hidden>
          <Icon size={16} strokeWidth={2.2} />
        </span>
        <div className="rae-card__text">
          <div className="rae-name">{element.name}</div>
          <div className="rae-card__caption">{caption}</div>
        </div>
        {node.moduleType && element.parent === null && (
          <span className="rae-chip rae-card__boundary" data-boundary={node.moduleType}>
            {node.moduleType}
          </span>
        )}
      </div>
      <div className="rae-card__actions">
        <NodeActions data={data} />
      </div>
      <ContainsButton data={data} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={HIDDEN_HANDLE} />
    </div>
  );
}

export const CardNode = memo(CardNodeImpl);
