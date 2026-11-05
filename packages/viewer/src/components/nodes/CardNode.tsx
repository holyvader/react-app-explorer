import { IconFolder } from "@rae/design-system/icons";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { CHANGE_LETTER, CHANGE_WORD } from "../../lib/diff.ts";
import { KIND_META, duration, fileNote, renderingKey, renderingLabel, routeCaption } from "../../lib/kinds.tsx";
import { isBlocks, useLod } from "../lod.ts";
import { ContainsButton, NodeActions } from "./NodeActions.tsx";
import { type CardFlowNode, HIDDEN_HANDLE } from "./types.ts";

/**
 * A single element: a flat card whose corners tell its kind (component rounded, hook pill, function
 * a rounded lead-in, server action slanted corners, type square, library dashed pill), its icon and
 * caption in the kind's colour. Actions show on hover / selection.
 * Plain HTML + canvas.css: it re-renders on every drag frame.
 */
function CardNodeImpl({ data }: NodeProps<CardFlowNode>) {
  const { node, element } = data;
  const lod = useLod();
  // zoomed far out: a block in the kind's colour with its name, large (no icon, caption, chips or actions)
  if (isBlocks(lod)) {
    const kind = element.kind === "folder" ? "folder" : node?.kind;
    if (!kind) return null;
    return (
      <div className="rae-card" data-kind={kind} data-missing={node?.missing || undefined} data-change={data.change} data-lod="overview">
        <Handle type="target" position={Position.Top} isConnectable={false} style={HIDDEN_HANDLE} />
        <div className="rae-card__big">{element.name}</div>
        <Handle type="source" position={Position.Bottom} isConnectable={false} style={HIDDEN_HANDLE} />
      </div>
    );
  }
  // An added folder with nothing drawn inside yet: a dashed folder card.
  if (element.kind === "folder") {
    return (
      <div className="rae-card" data-kind="folder">
        <Handle type="target" position={Position.Top} isConnectable={false} style={HIDDEN_HANDLE} />
        <div className="rae-card__body">
          <span className="rae-card__tile" aria-hidden>
            <IconFolder size={17} />
          </span>
          <div className="rae-card__text">
            <div className="rae-name">{element.name}</div>
            <div className="rae-card__caption">
              folder<span className="rae-card__extra">{data.scannedCount !== undefined ? ` · ${data.scannedCount} scanned elements` : ""}</span>
            </div>
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
  // compact (0.3–0.6): icon and name only
  const full = lod === "full";
  const meta = KIND_META[node.kind];
  const Icon = meta.icon;
  // the kind in its colour, then quiet extras: "component · async", "function · cached 1h"
  const what = node.route ? routeCaption(node.route) : (node.kind === "type" && node.typeKind && node.typeKind !== "type" ? node.typeKind : meta.label).toLowerCase();
  // a declaration standing for its file (merged scan) wears the file's badges: Next.js role, server / client
  const fileBadges = !!node.file;
  const extras = [fileNote(node), node.cache ? `cached${node.cache.revalidate ? ` ${duration(node.cache.revalidate)}` : ""}` : undefined, fileBadges ? undefined : node.nextRole, node.isAsync && !node.cache ? "async" : undefined].filter(Boolean);
  const boundary = !fileBadges && node.moduleType && element.parent === null && node.moduleType !== "server" ? node.moduleType : undefined;
  return (
    <div className="rae-card" data-kind={node.kind} data-missing={node.missing || undefined} data-change={data.change}>
      {data.change && (
        <span className="rae-change" data-change={data.change} title={`${CHANGE_WORD[data.change]} in this diff`}>
          {CHANGE_LETTER[data.change]}
        </span>
      )}
      <Handle type="target" position={Position.Top} isConnectable={false} style={HIDDEN_HANDLE} />
      <div className="rae-card__body">
        <span className="rae-card__tile" aria-hidden>
          <Icon size={17} />
        </span>
        <div className="rae-card__text">
          <div className="rae-name">{element.name}</div>
          {full && (
            <div className="rae-card__caption">
              {what}
              {extras.length > 0 && <span className="rae-card__extra"> · {extras.join(" · ")}</span>}
              {boundary && (
                <span className="rae-card__extra" data-boundary={boundary}>
                  {" "}
                  · {boundary}
                </span>
              )}
            </div>
          )}
        </div>
        {full && fileBadges && (node.nextRole || node.moduleType) && (
          <span className="rae-card__badges">
            {node.nextRole && <span className="rae-badge rae-badge--role">{node.nextRole}</span>}
            {node.moduleType && (
              <span className="rae-chip" data-boundary={node.moduleType}>
                {node.moduleType}
              </span>
            )}
          </span>
        )}
        {full && node.route?.rendering && (
          <span className="rae-chip rae-card__boundary" data-render={renderingKey(node.route.rendering)} title={node.route.rendering.reasons.join("\n")}>
            {renderingLabel(node.route.rendering)}
          </span>
        )}
      </div>
      {full && (
        <>
          <div className="rae-card__actions">
            <NodeActions data={data} />
          </div>
          <ContainsButton data={data} />
        </>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={HIDDEN_HANDLE} />
    </div>
  );
}

export const CardNode = memo(CardNodeImpl);
