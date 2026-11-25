import type { GraphNode, ParamDef, Snapshot } from "@rae/schema";
import { createContext, type CSSProperties, type ReactNode, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { tokenVar } from "@rae/design-system";
import type { GraphIndex } from "../graph/relations.ts";
import { cacheLabel, fileNote, KIND_META, renderingLabel } from "../lib/kinds.tsx";
import { DefinitionCode, SourceCode, TypeCode, type TokenRenderer } from "./Code.tsx";
import { targetOf } from "../lib/typeTargets.ts";
import { useExplorer } from "../store.ts";
import { shownReturn, shownType } from "../lib/typeText.ts";
import { showsTipDiff } from "../lib/nodeDiff.ts";
import { TipDiff } from "./TipDiff.tsx";
import { plural } from "../lib/text.ts";
import { boundaryOf } from "../lib/boundary.ts";
import { displayName } from "../lib/displayName.ts";

/** Characters a laid-out type may take in the tooltip. */
const TIP_COLUMNS = 52;

/*
 * Node tooltip — plain HTML (one instance for the whole canvas), in the same visual language as
 * the sidebar: kind icon tile, name + caption, code-coloured props / signatures, tinted chips.
 */

/** Items per section before "+N more". */
const MAX_ROWS = 8;


function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rae-tip__section">
      <div className="rae-tip__label">{label}</div>
      {children}
    </div>
  );
}

function More({ total }: { total: number }) {
  return total > MAX_ROWS ? <span className="rae-tip__more">+{total - MAX_ROWS} more</span> : null;
}

function Chips({ items }: { items: { text: string; color: string }[] }) {
  return (
    <div className="rae-tip__chips">
      {items.slice(0, MAX_ROWS).map((it, i) => (
        <span key={i} className="rae-tip__chip" style={{ "--c": tokenVar(it.color) } as CSSProperties}>
          {it.text}
        </span>
      ))}
      <More total={items.length} />
    </div>
  );
}

/** Type names in the tooltip link to their declarations: hovered, a card shows it; clicked, it's drawn (if it isn't), selected and centred. */
interface TypeLinks {
  owner: GraphNode;
  snapshot: Snapshot;
  hover: (target: GraphNode | null, at?: DOMRect) => void;
}
const TypeLinksContext = createContext<TypeLinks | null>(null);

/** A type in the tooltip, laid out like `TypeCode`, its project types and libraries as links. */
function TipType(props: { text: string; width?: number; flat?: boolean; optional?: boolean }) {
  const links = useContext(TypeLinksContext);
  const render: TokenRenderer | undefined = links
    ? (t, key) => {
        const target = t.k === "type" ? targetOf(links.snapshot, links.owner, t.t) : undefined;
        if (!target || target.id === links.owner.id)
          return (
            <span key={key} className={`rae-tok--${t.k}`}>
              {t.t}
            </span>
          );
        const go = () => {
          links.hover(null);
          useExplorer.getState().addNodes([target.id], { select: target.id, focus: target.id, anchor: links.owner.id });
        };
        return (
          <span
            key={key}
            className={`rae-tok--${t.k} rae-tok--link`}
            role="link"
            tabIndex={0}
            onMouseEnter={(e) => links.hover(target, e.currentTarget.getBoundingClientRect())}
            onMouseLeave={() => links.hover(null)}
            onClick={(e) => {
              e.stopPropagation();
              go();
            }}
            onKeyDown={(e) => e.key === "Enter" && go()}
          >
            {t.t}
          </span>
        );
      }
    : undefined;
  return <TypeCode {...props} render={render} />;
}

/** Characters a signature may take on one line before it puts each parameter on its own. */
const SIGNATURE_LINE = 58;

/**
 * A function's signature as one line of code, its types linked: `scenariosOf(node: OutlineNode, doc:
 * DesignDocumentInput): ScenarioEntry[]` — a parameter per line when it's longer than that.
 */
function SignatureLine({ n }: { n: GraphNode }) {
  const params = n.signature?.params ?? [];
  const ret = shownReturn(n.signature);
  const typeOf = (p: ParamDef) => shownType(p);
  const flatLength = n.name.length + 2 + params.reduce((sum, p) => sum + p.name.length + 2 + (typeOf(p)?.length ?? 0) + 2, 0) + (ret ? ret.length + 2 : 0);
  const split = flatLength > SIGNATURE_LINE && params.length > 0;
  const param = (p: ParamDef, i: number) => (
    <span key={i}>
      {split ? "\n  " : i > 0 ? <Tok k="punct">, </Tok> : null}
      <Tok k="name">{p.name}</Tok>
      {typeOf(p) && (
        <>
          <Tok k="punct">{p.optional && !p.default ? "?: " : ": "}</Tok>
          <TipType text={typeOf(p)!} flat optional={p.optional} />
        </>
      )}
      {split && <Tok k="punct">,</Tok>}
    </span>
  );
  return (
    <span className="rae-code">
      <span className="rae-tok--fn">{n.name}</span>
      <Tok k="punct">(</Tok>
      {params.map(param)}
      {split && "\n"}
      <Tok k="punct">)</Tok>
      {ret && (
        <>
          <Tok k="punct">: </Tok>
          <TipType text={ret} flat />
        </>
      )}
    </span>
  );
}

/** The hovered type's declaration, next to its name (portalled: the tooltip is transformed, so `fixed` inside it isn't the viewport's). */
function TypeCard({ target, at }: { target: GraphNode; at: DOMRect }) {
  const width = 420;
  const left = Math.max(8, Math.min(at.left, window.innerWidth - width - 8));
  const below = at.bottom + 6 + 220 < window.innerHeight;
  return createPortal(
    <div className="rae-typecard" style={{ left, ...(below ? { top: at.bottom + 6 } : { bottom: window.innerHeight - at.top + 6 }), maxWidth: width }}>
      <div className="rae-typecard__head">
        {target.kind === "type" ? `${target.typeKind ?? "type"} · ${target.filePath}` : target.kind === "external" ? `from ${target.name}` : `${KIND_META[target.kind].label.toLowerCase()} · ${target.filePath}`} — click to go to it
      </div>
      {target.typeText ? <DefinitionCode text={target.typeText} width={56} maxLines={16} /> : <span className="rae-tok--type">{target.name}</span>}
    </div>,
    document.body,
  );
}

const Tok = ({ k, children }: { k: "name" | "type" | "value" | "punct" | "keyword"; children: ReactNode }) => <span className={`rae-tok rae-tok--${k}`}>{children}</span>;

function ParamRows({ params }: { params: ParamDef[] }) {
  if (!params.length) return <div className="rae-tip__empty">none</div>;
  return (
    <div className="rae-tip__code">
      {params.slice(0, MAX_ROWS).map((p, i) => (
        <div key={i}>
          <Tok k="name">{p.name}</Tok>
          {shownType(p) && (
            <>
              <Tok k="punct">{p.optional && !p.default ? "?: " : ": "}</Tok>
              <TipType text={shownType(p)!} flat optional={p.optional} />
            </>
          )}
          {p.default && (
            <>
              <Tok k="punct"> = </Tok>
              <SourceCode text={p.default} />
            </>
          )}
        </div>
      ))}
      <More total={params.length} />
    </div>
  );
}

/** The project's own hooks it calls (not React's or libraries'), by name, each once (×N). Details live on the hook. */
const hookNames = (n: GraphNode, s: Snapshot) => {
  const counts = new Map<string, number>();
  for (const h of n.hooksUsed ?? []) {
    const target = h.targetId ? s.nodes[h.targetId] : undefined;
    if (target?.kind !== "hook" || target.id === n.id) continue;
    counts.set(target.name, (counts.get(target.name) ?? 0) + 1);
  }
  return [...counts].map(([name, c]) => (c > 1 ? `${name} ×${c}` : name));
};

/** `<T extends Item = Item, K>` and what an interface extends, when there is any. */
function GenericsSection({ n }: { n: GraphNode }) {
  if (!n.typeParams?.length && !n.extends?.length) return null;
  return (
    <>
      {n.typeParams?.length ? (
        <Section label="Type parameters">
          <div className="rae-tip__code">
            {n.typeParams.slice(0, MAX_ROWS).map((t) => (
              <div key={t.name}>
                <Tok k="name">{t.name}</Tok>
                {t.constraint && (
                  <>
                    <Tok k="keyword"> extends </Tok>
                    <Tok k="type">{t.constraint}</Tok>
                  </>
                )}
                {t.default && (
                  <>
                    <Tok k="punct"> = </Tok>
                    <Tok k="type">{t.default}</Tok>
                  </>
                )}
              </div>
            ))}
          </div>
        </Section>
      ) : null}
      {n.extends?.length ? (
        <Section label="Extends">
          <div className="rae-tip__code">
            {n.extends.slice(0, MAX_ROWS).map((x, i) => (
              <div key={i}>
                <Tok k="type">{x}</Tok>
              </div>
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

/** What a node's tooltip says, by kind. */
function content(n: GraphNode, s: Snapshot, index: GraphIndex): ReactNode {
  return (
    <>
      {n.cache && (
        <Section label="Cache">
          <div className="rae-tip__code">
            <Tok k="keyword">{cacheLabel(n.cache)}</Tok>
            {n.cache.tags?.length ? <Tok k="punct">{` · tags ${n.cache.tags.join(", ")}`}</Tok> : null}
          </div>
        </Section>
      )}
      <GenericsSection n={n} />
      {kindContent(n, s, index)}
    </>
  );
}

function kindContent(n: GraphNode, s: Snapshot, index: GraphIndex): ReactNode {
  const out = index.out.get(n.id) ?? [];
  const inc = index.in.get(n.id) ?? [];
  switch (n.kind) {
    case "component": {
      const renders = [...new Set(out.filter((e) => e.kind === "renders").map((e) => e.to))].map((id) => s.nodes[id]).filter((x): x is GraphNode => !!x);
      return (
        <>
          <Section label="Props">
            {n.props?.length ? (
              <div className="rae-tip__code">
                {n.props.slice(0, MAX_ROWS).map((p) => (
                  <div key={p.name}>
                    <Tok k="name">{p.name}</Tok>
                    <Tok k="punct">{p.optional ? "?: " : ": "}</Tok>
                    <TipType text={shownType(p) ?? "unknown"} flat optional={p.optional} />
                    {p.default && (
                      <>
                        <Tok k="punct"> = </Tok>
                        <SourceCode text={p.default} />
                      </>
                    )}
                  </div>
                ))}
                <More total={n.props.length} />
              </div>
            ) : (
              <div className="rae-tip__empty">none</div>
            )}
          </Section>
          {hookNames(n, s).length > 0 && (
            <Section label="Custom hooks">
              <Chips items={hookNames(n, s).map((h) => ({ text: h, color: "kind.hook.solid" }))} />
            </Section>
          )}
          <Section label="Renders">
            {renders.length ? (
              <Chips items={renders.map((r) => ({ text: r.name, color: `kind.${r.kind}.solid` }))} />
            ) : (
              <div className="rae-tip__empty">only native elements</div>
            )}
          </Section>
        </>
      );
    }
    case "hook":
    case "function":
    case "serverAction":
      return (
        <>
          <Section label="Inputs">
            <ParamRows params={n.signature?.params ?? []} />
          </Section>
          <Section label="Output">
            <div className="rae-tip__code rae-tip__pre">
              <TipType text={shownReturn(n.signature) ?? "unknown"} width={TIP_COLUMNS} />
            </div>
          </Section>
          {hookNames(n, s).length > 0 && (
            <Section label="Custom hooks">
              <Chips items={hookNames(n, s).map((h) => ({ text: h, color: "kind.hook.solid" }))} />
            </Section>
          )}
        </>
      );
    case "module": {
      if (n.middleware) {
        const ran = out.filter((e) => e.kind === "runsBefore").length;
        return (
          <>
            <Section label="Matcher">
              <div className="rae-tip__code">
                {n.middleware.matchers.length ? n.middleware.matchers.map((m, i) => (
                  <div key={i}>
                    <Tok k="value">{m.source}</Tok>
                  </div>
                )) : <Tok k="punct">none — every route</Tok>}
              </div>
            </Section>
            <div className="rae-tip__foot">Runs before {plural(ran, "route")}</div>
          </>
        );
      }
      const decls = out.filter((e) => e.kind === "declares").map((e) => s.nodes[e.to]).filter((d): d is GraphNode => !!d);
      const exported = decls.filter((d) => d.exported);
      const reexports = out.filter((e) => e.kind === "imports" && e.importType === "reexport");
      return (
        <>
          <Section label="Exports">
            {exported.length ? (
              <Chips items={exported.map((d) => ({ text: `${d.exportNames?.includes("default") ? "default · " : ""}${d.name}`, color: `kind.${d.kind}.solid` }))} />
            ) : (
              !reexports.length && <div className="rae-tip__empty">nothing</div>
            )}
          </Section>
          {reexports.length > 0 && (
            <Section label="Re-exports">
              <div className="rae-tip__code">
                {reexports.slice(0, MAX_ROWS).map((e, i) => (
                  <div key={i}>
                    <Tok k="name">{e.specifiers?.join(", ") || "*"}</Tok>
                    <Tok k="punct"> from </Tok>
                    <Tok k="value">{s.nodes[e.to]?.filePath ?? e.to}</Tok>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      );
    }
    case "route": {
      const r = n.route!;
      const files = Object.entries(r.files).filter(([, id]) => !!id);
      return (
        <>
          <Section label="URL">
            <div className="rae-tip__code">
              <Tok k="value">{r.url}</Tok>
            </div>
          </Section>
          {r.rendering && (
            <Section label="Rendering">
              <div className="rae-tip__code">
                <Tok k="keyword">{renderingLabel(r.rendering)}</Tok>
                <Tok k="punct"> — {r.rendering.reasons[0]}</Tok>
              </div>
            </Section>
          )}
          {r.methods?.length ? (
            <Section label="Methods">
              <Chips items={r.methods.map((m) => ({ text: m, color: "relation.fetches" }))} />
            </Section>
          ) : null}
          <Section label="Files">
            <Chips items={files.map(([role]) => ({ text: role, color: "kind.route.solid" }))} />
          </Section>
          {r.middleware && (
            <Section label="Middleware">
              <div className="rae-tip__code">
                <Tok k="name">{s.nodes[r.middleware.id]?.name ?? r.middleware.id}</Tok>
                <Tok k="punct"> · </Tok>
                <Tok k="value">{r.middleware.matcher ?? "every route"}</Tok>
              </div>
            </Section>
          )}
          <div className="rae-tip__foot">Navigated to from {new Set(inc.filter((e) => e.kind === "navigates" || e.kind === "fetches").map((e) => e.from)).size} places</div>
        </>
      );
    }
    case "type":
      return (
        <>
          <Section label={n.typeKind === "interface" ? "Interface" : n.typeKind === "enum" ? "Enum" : "Type"}>
            <div className="rae-tip__code rae-tip__pre">
              <DefinitionCode text={n.typeText ?? ""} width={TIP_COLUMNS} maxLines={14} />
            </div>
          </Section>
          <div className="rae-tip__foot">Used by {new Set(inc.filter((e) => e.kind === "usesType").map((e) => e.from)).size} declarations</div>
        </>
      );
    case "external": {
      const names = [...new Set(inc.flatMap((e) => e.specifiers ?? []))];
      return (
        <>
          <Section label="Imported names">
            {names.length ? <Chips items={names.map((x) => ({ text: x, color: "kind.external.solid" }))} /> : <div className="rae-tip__empty">side-effect import</div>}
          </Section>
          <div className="rae-tip__foot">Used by {new Set(inc.map((e) => e.from)).size} modules / declarations</div>
        </>
      );
    }
  }
}

export interface TipState {
  id: string;
  /** The hovered node's box on screen. */
  rect: { left: number; top: number; width: number; bottom: number };
}

/** Room needed above a node to show the tooltip there; with less, it goes below. */
const ROOM_ABOVE = 260;
/** Half the tooltip's max width + margin, to keep it on screen when centring (with the diff column: wider). */
const HALF = 200;
const HALF_DIFF = 262;
/** The gap between the node and the tooltip. */
const GAP = 12;
/** The app's toolbar over the canvas (44px) and a margin: the tooltip stays below it. */
const TOP = 52;

export interface NodeTooltipProps {
  tip: TipState | null;
  snapshot?: Snapshot;
  index?: GraphIndex;
  /** The diff view shows code: a changed element's changed lines in a left column. */
  diffCode?: boolean;
  onOpenDiff: (node: GraphNode) => void;
  /** The pointer on the tooltip keeps it open (it's left on its own when the pointer goes). */
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

/**
 * One tooltip for the whole canvas, above the hovered node and centred on it (below it when
 * there's no room above). It stays open while the pointer is on it: its code can be scrolled
 * and selected, and the diff column's button opens the code diff dialog.
 */
export function NodeTooltip(props: NodeTooltipProps) {
  // the hovered type name's card; reset when the tooltip moves to another node
  const [card, setCard] = useState<{ target: GraphNode; at: DOMRect; tip: string } | null>(null);
  const id = props.tip?.id;
  const n = id ? props.snapshot?.nodes[id] : undefined;
  if (!props.tip || !props.snapshot || !props.index || !n) return null;
  const links: TypeLinks = { owner: n, snapshot: props.snapshot, hover: (target, at) => setCard(target && at ? { target, at, tip: n.id } : null) };
  return (
    <TypeLinksContext.Provider value={links}>
      <TooltipBox {...props} n={n} />
      {card && card.tip === n.id && <TypeCard target={card.target} at={card.at} />}
    </TypeLinksContext.Provider>
  );
}

function TooltipBox({ tip, snapshot, index, n, diffCode = false, onOpenDiff, onPointerEnter, onPointerLeave }: NodeTooltipProps & { n: GraphNode }) {
  if (!tip || !snapshot || !index) return null;
  const meta = KIND_META[n.kind];
  const Icon = meta.icon;
  const caption = [meta.label, fileNote(n), boundaryOf(n), n.nextRole ? `next ${n.nextRole}` : undefined, n.isAsync ? "async" : undefined].filter(Boolean).join(" · ");
  const { rect } = tip;
  const diff = showsTipDiff(snapshot, n, diffCode);
  const half = diff ? HALF_DIFF : HALF;
  const centre = Math.min(Math.max(rect.left + rect.width / 2, half), window.innerWidth - half);
  // the diff column is tall: it goes where there's more room, and its lines scroll within that
  const roomAbove = rect.top - GAP - TOP;
  const roomBelow = window.innerHeight - rect.bottom - GAP - 8;
  const above = diff ? roomAbove >= roomBelow : rect.top - TOP >= ROOM_ABOVE;
  const path = `${n.filePath}${n.loc && n.kind !== "module" && n.kind !== "external" ? `:${n.loc.line}` : ""}`;
  const titleBlock = (
    <div className="rae-tip__head">
      <span className="rae-card__tile rae-tip__tile">
        <Icon size={15} strokeWidth={2.2} />
      </span>
      <div className="rae-tip__titles">
        <div className="rae-tip__title">{displayName(n)}</div>
        <div className="rae-tip__caption">{caption}</div>
        {diff && <div className="rae-tip__path">{path}</div>}
      </div>
    </div>
  );
  return (
    <div
      className="rae-tip"
      role="tooltip"
      data-kind={n.kind}
      data-side={above ? "top" : "bottom"}
      data-diff={diff ? "" : undefined}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={
        {
          left: centre,
          top: above ? rect.top - GAP : rect.bottom + GAP,
          transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
          "--room": `${Math.max(above ? roomAbove : roomBelow, 160)}px`,
        } as CSSProperties
      }
    >
      {diff ? (
        // a changed element: one column, its signature over the changed lines
        <TipDiff node={n} snapshot={snapshot} onOpenDiff={onOpenDiff} head={titleBlock} signature={n.signature && <SignatureLine n={n} />} />
      ) : (
        <div className="rae-tip__main">
          {titleBlock}
          <div className="rae-tip__path">{path}</div>
          <div className="rae-tip__body">{content(n, snapshot, index)}</div>
        </div>
      )}
    </div>
  );
}
