import type { GraphNode, ParamDef, Snapshot } from "@rae/schema";
import type { CSSProperties, ReactNode } from "react";
import type { GraphIndex } from "../graph/relations.ts";
import { fileNote, KIND_META } from "../lib/kinds.tsx";

/*
 * Node tooltip — plain HTML (one instance for the whole canvas), in the same visual language as
 * the sidebar: kind icon tile, name + caption, code-coloured props / signatures, tinted chips.
 */

/** Items per section before "+N more". */
const MAX_ROWS = 8;

/** CSS variable of a colour token, matching the design system's `tokenVar`. */
const tokenVar = (token: string) => `var(--chakra-colors-${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replaceAll(".", "-")})`;

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

const Tok = ({ k, children }: { k: "name" | "type" | "value" | "punct" | "keyword"; children: ReactNode }) => <span className={`rae-tok rae-tok--${k}`}>{children}</span>;

function ParamRows({ params }: { params: ParamDef[] }) {
  if (!params.length) return <div className="rae-tip__empty">none</div>;
  return (
    <div className="rae-tip__code">
      {params.slice(0, MAX_ROWS).map((p, i) => (
        <div key={i}>
          <Tok k="name">{p.name}</Tok>
          {p.type && (
            <>
              <Tok k="punct">{p.optional && !p.default ? "?: " : ": "}</Tok>
              <Tok k="type">{p.type}</Tok>
            </>
          )}
          {p.default && (
            <>
              <Tok k="punct"> = </Tok>
              <Tok k="value">{p.default}</Tok>
            </>
          )}
        </div>
      ))}
      <More total={params.length} />
    </div>
  );
}

/** Just the hook names, each once (×N when called several times). Details live in the sidebar. */
const hookNames = (n: GraphNode) => {
  const counts = new Map<string, number>();
  for (const h of n.hooksUsed ?? []) counts.set(h.hook, (counts.get(h.hook) ?? 0) + 1);
  return [...counts].map(([name, c]) => (c > 1 ? `${name} ×${c}` : name));
};

/** What a node's tooltip says, by kind. */
function content(n: GraphNode, s: Snapshot, index: GraphIndex): ReactNode {
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
                    <Tok k="type">{p.type ?? "unknown"}</Tok>
                    {p.default && (
                      <>
                        <Tok k="punct"> = </Tok>
                        <Tok k="value">{p.default}</Tok>
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
          {(n.hooksUsed?.length ?? 0) > 0 && (
            <Section label="Hooks">
              <Chips items={hookNames(n).map((h) => ({ text: h, color: "kind.hook.solid" }))} />
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
            <div className="rae-tip__code">
              <Tok k="type">{n.signature?.returnType ?? "unknown"}</Tok>
            </div>
          </Section>
          {n.kind === "hook" && (n.hooksUsed?.length ?? 0) > 0 && (
            <Section label="Uses hooks">
              <Chips items={hookNames(n).map((h) => ({ text: h, color: "kind.hook.solid" }))} />
            </Section>
          )}
        </>
      );
    case "module": {
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
/** Half the tooltip's max width + margin, to keep it on screen when centring. */
const HALF = 200;

/**
 * One tooltip for the whole canvas, above the hovered node and centred on it (below it when
 * there's no room above).
 */
export function NodeTooltip({ tip, snapshot, index }: { tip: TipState | null; snapshot?: Snapshot; index?: GraphIndex }) {
  if (!tip || !snapshot || !index) return null;
  const n = snapshot.nodes[tip.id];
  if (!n) return null;
  const meta = KIND_META[n.kind];
  const Icon = meta.icon;
  const caption = [meta.label, fileNote(n), n.moduleType, n.nextRole ? `next ${n.nextRole}` : undefined, n.isAsync ? "async" : undefined].filter(Boolean).join(" · ");
  const { rect } = tip;
  const centre = Math.min(Math.max(rect.left + rect.width / 2, HALF), window.innerWidth - HALF);
  const above = rect.top >= ROOM_ABOVE;
  return (
    <div
      className="rae-tip"
      role="tooltip"
      data-kind={n.kind}
      data-side={above ? "top" : "bottom"}
      style={{
        left: centre,
        top: above ? rect.top - 12 : rect.bottom + 12,
        transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
      }}
    >
      <div className="rae-tip__head">
        <span className="rae-card__tile rae-tip__tile">
          <Icon size={15} strokeWidth={2.2} />
        </span>
        <div className="rae-tip__titles">
          <div className="rae-tip__title">{n.name}</div>
          <div className="rae-tip__caption">{caption}</div>
        </div>
      </div>
      <div className="rae-tip__path">
        {n.filePath}
        {n.loc && n.kind !== "module" && n.kind !== "external" ? `:${n.loc.line}` : ""}
      </div>
      <div className="rae-tip__body">{content(n, snapshot, index)}</div>
    </div>
  );
}
