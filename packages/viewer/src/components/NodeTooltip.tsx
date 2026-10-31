import type { GraphNode, Snapshot } from "@rae/schema";
import type { ReactNode } from "react";
import { FOLDER_PREFIX } from "../graph/drawn.ts";
import type { GraphIndex } from "../graph/relations.ts";
import { KIND_META } from "../lib/kinds.tsx";

/** Rows per section before "…N more". */
const MAX_ROWS = 10;

function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="rae-tip__list">
      {items.slice(0, MAX_ROWS).map((it, i) => (
        <li key={i}>{it}</li>
      ))}
      {items.length > MAX_ROWS && <li className="rae-tip__muted">…{items.length - MAX_ROWS} more</li>}
    </ul>
  );
}

function Section({ label, items, empty }: { label: string; items: ReactNode[]; empty?: string }) {
  if (!items.length && !empty) return null;
  return (
    <div className="rae-tip__section">
      <div className="rae-tip__label">{label}</div>
      {items.length ? <List items={items} /> : <div className="rae-tip__muted">{empty}</div>}
    </div>
  );
}

const sig = (n: GraphNode) =>
  (n.signature?.params ?? []).map((p) => `${p.name}${p.optional && !p.default ? "?" : ""}${p.type ? `: ${p.type}` : ""}${p.default ? ` = ${p.default}` : ""}`);

/** What a node's tooltip says, by kind. */
function content(id: string, s: Snapshot, index: GraphIndex): ReactNode {
  if (id.startsWith(FOLDER_PREFIX)) {
    const dir = id.slice(FOLDER_PREFIX.length);
    const files = Object.values(s.nodes).filter((n) => n.kind === "module" && n.filePath.startsWith(dir + "/")).length;
    return (
      <>
        <div className="rae-tip__title">{dir}/</div>
        <div className="rae-tip__sub">Folder · {files} scanned files</div>
      </>
    );
  }
  const n = s.nodes[id];
  if (!n) return null;
  const out = index.out.get(id) ?? [];
  const inc = index.in.get(id) ?? [];
  const name = (to: string) => s.nodes[to]?.name ?? to;
  const header = (
    <>
      <div className="rae-tip__title">{n.name}</div>
      <div className="rae-tip__sub">
        {KIND_META[n.kind].label}
        {n.moduleType ? ` · ${n.moduleType}` : ""}
        {n.nextRole ? ` · next ${n.nextRole}` : ""}
        {n.isAsync ? " · async" : ""} · {n.filePath}
        {n.loc && n.kind !== "module" ? `:${n.loc.line}` : ""}
      </div>
    </>
  );

  switch (n.kind) {
    case "component": {
      const renders = [...new Set(out.filter((e) => e.kind === "renders").map((e) => name(e.to)))];
      return (
        <>
          {header}
          <Section label="Props" items={(n.props ?? []).map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type ?? "?"}${p.default ? ` = ${p.default}` : ""}`)} empty="none" />
          <Section label="Hooks" items={(n.hooksUsed ?? []).map((h) => `${h.assignedTo ? `${h.assignedTo} = ` : ""}${h.hook}(${h.args.join(", ")})${h.returnType ? ` → ${h.returnType}` : ""}`)} />
          <Section label="Renders" items={renders.map((r) => `<${r}>`)} empty="only native elements" />
        </>
      );
    }
    case "hook":
    case "function":
    case "serverAction":
      return (
        <>
          {header}
          <Section label="Inputs" items={sig(n)} empty="none" />
          <Section label="Output" items={[n.signature?.returnType ?? "unknown"]} />
          {n.kind === "hook" && <Section label="Uses hooks" items={(n.hooksUsed ?? []).map((h) => `${h.hook}${h.returnType ? ` → ${h.returnType}` : ""}`)} />}
        </>
      );
    case "module": {
      const decls = out.filter((e) => e.kind === "declares").map((e) => s.nodes[e.to]).filter((d): d is GraphNode => !!d);
      const exported = decls.filter((d) => d.exported).map((d) => `${d.exportNames?.includes("default") ? "default " : ""}${d.name} — ${KIND_META[d.kind].label.toLowerCase()}`);
      const reexports = out.filter((e) => e.kind === "imports" && e.importType === "reexport").map((e) => `${e.specifiers?.join(", ") || "*"} from ${s.nodes[e.to]?.filePath ?? e.to}`);
      return (
        <>
          {header}
          <Section label="Exports" items={exported} empty={reexports.length ? undefined : "nothing"} />
          <Section label="Re-exports" items={reexports} />
          <Section label="Imported by" items={[...new Set(inc.filter((e) => e.kind === "imports").map((e) => s.nodes[e.from]?.filePath ?? e.from))]} />
        </>
      );
    }
    case "external": {
      const names = [...new Set(inc.flatMap((e) => e.specifiers ?? []))];
      const users = new Set(inc.map((e) => e.from)).size;
      return (
        <>
          {header}
          <Section label="Imported names" items={names} />
          <div className="rae-tip__section rae-tip__muted">Used by {users} modules/declarations</div>
        </>
      );
    }
  }
}

export interface TipState {
  id: string;
  x: number;
  y: number;
}

/** One tooltip for the whole canvas, following the hovered node. Plain HTML: cheap to show/hide. */
export function NodeTooltip({ tip, snapshot, index }: { tip: TipState | null; snapshot?: Snapshot; index?: GraphIndex }) {
  if (!tip || !snapshot || !index) return null;
  const body = content(tip.id, snapshot, index);
  if (!body) return null;
  const left = tip.x + 16 + 380 > window.innerWidth ? Math.max(8, tip.x - 396) : tip.x + 16;
  const top = Math.min(tip.y + 18, window.innerHeight - 160);
  return (
    <div className="rae-tip" role="tooltip" style={{ left, top }}>
      {body}
    </div>
  );
}
