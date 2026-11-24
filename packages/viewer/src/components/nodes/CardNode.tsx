import { IconFolder } from "@rae/design-system/icons";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { Fragment, memo, type ReactNode } from "react";
import { CHANGE_LETTER, CHANGE_WORD } from "../../lib/diff.ts";
import { CARD_HEIGHT } from "../../graph/layout.ts";
import { KIND_META, duration, fileNote, renderingKey, renderingLabel, routeCaption } from "../../lib/kinds.tsx";
import { isBlocks, useLod } from "../lod.ts";
import { useExplorer } from "../../store.ts";
import { propsChipLabel, propsCount } from "../../lib/propsCount.ts";
import { ContainsButton, NodeActions } from "./NodeActions.tsx";
import { TagOutline } from "./TagOutline.tsx";
import { type CardFlowNode, HIDDEN_HANDLE } from "./types.ts";
import { boundaryOf } from "../../lib/boundary.ts";

/**
 * A single element: a flat card whose corners tell its kind (component rounded, hook pill, function
 * a rounded lead-in, server action slanted corners, type square, library dashed pill), its icon and
 * caption in the kind's colour. Actions show on hover / selection.
 * Plain HTML + canvas.css: it re-renders on every drag frame.
 */
/** A component's name written as JSX, `<TodoList />`: the brackets say "component" (no icon). */
function JsxName({ name }: { name: string }) {
  return (
    <>
      <span className="rae-jsx">&lt;</span>
      {name}
      <span className="rae-jsx"> /&gt;</span>
    </>
  );
}

/**
 * A component's private props type (only it uses it), named in its caption: `ButtonProps` in the
 * type colour. Click: the type's details, without drawing it.
 */
function PropsTypeLink({ id, name, keyword, owner }: { id: string; name: string; keyword: string; owner: string }) {
  const label = `${keyword} ${name}: the props of ${owner}, used nowhere else. Click for its details.`;
  return (
    <button
      type="button"
      className="rae-card__props nodrag nopan"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        const st = useExplorer.getState();
        st.setDetailsOpen(true);
        st.inspect(id);
      }}
    >
      {name}
    </button>
  );
}

function CardNodeImpl({ data, width, height }: NodeProps<CardFlowNode>) {
  const { node, element } = data;
  const lod = useLod();
  // components are a tag, < >: their outline is an SVG (TagOutline), their name JSX
  const isComponent = node?.kind === "component";
  // types are a blueprint (canvas.css): dashed, a fine grid, corner marks
  const tag = isComponent ? <TagOutline width={width ?? 240} height={height ?? CARD_HEIGHT} /> : node?.kind === "type" && <span className="rae-card__marks" aria-hidden />;
  // zoomed far out: a block in the kind's colour with its name, large (no icon, caption, chips or actions)
  if (isBlocks(lod)) {
    const kind = element.kind === "folder" ? "folder" : node?.kind;
    if (!kind) return null;
    return (
      <div className="rae-card" data-kind={kind} data-missing={node?.missing || undefined} data-change={data.change} data-lod="overview">
        {tag}
        <Handle type="target" position={Position.Top} isConnectable={false} style={HIDDEN_HANDLE} />
        <div className="rae-card__big">{isComponent ? <JsxName name={element.name} /> : element.name}</div>
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
  const moduleType = boundaryOf(node);
  const boundary = !fileBadges && moduleType && element.parent === null && moduleType !== "server" ? moduleType : undefined;
  // a component's props, as a chip: how many (own + inherited); the node tooltip lists them
  const props = propsCount(node);
  // the caption: the kind in its colour (not for components: the tag and <Name /> say it), then quiet extras
  const caption: ReactNode[] = [
    !(isComponent && !node.route) && what,
    data.propsType && <PropsTypeLink {...data.propsType} owner={element.name} />,
    ...extras.map((x) => <span className="rae-card__extra">{x}</span>),
    boundary && (
      <span className="rae-card__extra" data-boundary={boundary}>
        {boundary}
      </span>
    ),
  ].filter(Boolean);
  return (
    <div className="rae-card" data-kind={node.kind} data-missing={node.missing || undefined} data-change={data.change}>
      {tag}
      {data.change && (
        <span className="rae-change" data-change={data.change} title={`${CHANGE_WORD[data.change]} in this diff`}>
          {CHANGE_LETTER[data.change]}
        </span>
      )}
      <Handle type="target" position={Position.Top} isConnectable={false} style={HIDDEN_HANDLE} />
      <div className="rae-card__body">
        {!isComponent && (
          <span className="rae-card__tile" aria-hidden>
            <Icon size={17} />
          </span>
        )}
        <div className="rae-card__text">
          <div className="rae-name">{isComponent ? <JsxName name={element.name} /> : element.name}</div>
          {full && caption.length > 0 && (
            <div className="rae-card__caption">
              {caption.map((part, i) => (
                <Fragment key={i}>
                  {i > 0 && <span className="rae-card__extra"> · </span>}
                  {part}
                </Fragment>
              ))}
            </div>
          )}
        </div>
        {full && ((fileBadges && (node.nextRole || moduleType)) || props) && (
          <span className="rae-card__badges">
            {props && (
              <span className="rae-chip rae-chip--props">
                {propsChipLabel(props)}
              </span>
            )}
            {fileBadges && node.nextRole && <span className="rae-badge rae-badge--role">{node.nextRole}</span>}
            {fileBadges && moduleType && (
              <span className="rae-chip" data-boundary={moduleType}>
                {moduleType}
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
