import { Box, Text, Tooltip } from "@rae/design-system";
import type { GraphNode, Snapshot } from "@rae/schema";
import { useMemo, useState } from "react";
import { isPrimitiveType } from "../lib/typeText.ts";
import { type FoldRule, layoutDefinition, layoutType, type Tok } from "../lib/syntax.ts";
import { useExplorer } from "../store.ts";
import { useCodeColumns } from "../lib/useColumns.ts";
import { CodeLines, DefinitionCode, TypeCode } from "./Code.tsx";
import { plural } from "../lib/text.ts";

/** Lines of a definition shown in a tooltip before "…". */
const PREVIEW_LINES = 24;
/** The tooltip's width, in characters. */
const TOOLTIP_COLUMNS = 72;

/** Type declarations by name, per snapshot: the fallback for names the owner didn't record (inferred types). */
const byName = new WeakMap<Snapshot, Map<string, string[]>>();
function typesNamed(s: Snapshot, name: string): string[] {
  let m = byName.get(s);
  if (!m) {
    m = new Map();
    for (const n of Object.values(s.nodes)) if (n.kind === "type") (m.get(n.name) ?? m.set(n.name, []).get(n.name)!).push(n.id);
    byName.set(s, m);
  }
  return m.get(name) ?? [];
}

/** The node a name in `owner`'s type text stands for: its recorded reference, else a unique type of that name. */
function targetOf(s: Snapshot, owner: GraphNode | undefined, name: string): GraphNode | undefined {
  const id = owner?.typeRefs?.[name];
  if (id) return s.nodes[id];
  const named = typesNamed(s, name);
  return named.length === 1 ? s.nodes[named[0]!] : undefined;
}

function Preview({ text, targets }: { text: string; targets: GraphNode[] }) {
  return (
    <Box maxW="min(620px, 80vw)" fontSize="2xs" lineHeight="1.6">
      {text && <TypeCode text={text} width={TOOLTIP_COLUMNS} />}
      {targets.map((t, i) => (
        <Box key={t.id} mt={text || i ? "2.5" : 0} pt={text || i ? "2" : 0} borderTopWidth={text || i ? "1px" : 0} borderColor="border.muted">
          <Text fontSize="2xs" opacity={0.75} mb="1">
            {t.kind === "type" ? `${t.typeKind ?? "type"} · ${t.filePath}` : `from ${t.name}`} — click the name to add it
          </Text>
          {t.typeText && <DefinitionCode text={t.typeText} width={TOOLTIP_COLUMNS} maxLines={PREVIEW_LINES} />}
        </Box>
      ))}
    </Box>
  );
}

/**
 * A TypeScript type, coloured: inline types are laid out to the room they have (one line when it
 * fits, objects / parameters / long unions broken over lines, `| undefined` dropped from optional
 * members); `block` shows a definition as written. Names of project types and libraries are links
 * that add them to the diagram; hovering shows those definitions. `owner` is the node whose
 * annotation this is (its `typeRefs` say what each name resolves to). `flat`: one line, always.
 */
export function TypeText({ text, owner, block, flat, optional }: { text: string; owner?: GraphNode; block?: boolean; flat?: boolean; /** an optional prop / parameter's type: no `| undefined` */ optional?: boolean }) {
  const snapshot = useExplorer((s) => s.snapshot);
  const [ref, cols] = useCodeColumns<HTMLSpanElement>();
  // folded objects: by default nested ones that'd take several lines (a definition's: any member's
  // object that doesn't fit); the user's clicks override, per object
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const fold = useMemo<FoldRule>(
    () => (id, depth, fits) => toggled[id] ?? (block ? !fits : depth >= 1 && !fits),
    [toggled, block],
  );
  const lines = useMemo(
    () => (block ? layoutDefinition(text, cols, flat ? undefined : fold) : layoutType(text, { width: cols, flat, optional, fold: flat ? undefined : fold })),
    [text, block, cols, flat, optional, fold],
  );

  // what the names in it stand for (types of the project, libraries), looked up before rendering
  const links = useMemo(() => {
    const m = new Map<string, GraphNode>();
    if (!snapshot) return m;
    for (const line of lines)
      for (const t of line) {
        if (t.k !== "type" || m.has(t.t)) continue;
        const target = targetOf(snapshot, owner, t.t);
        if (target && target.id !== owner?.id) m.set(t.t, target);
      }
    return m;
  }, [lines, snapshot, owner]);
  const targets = [...new Map([...links.values()].filter((n) => n.kind === "type" || n.kind === "external").map((n) => [n.id, n])).values()];
  const add = (target: GraphNode) => useExplorer.getState().addNodes([target.id], { select: target.id, focus: target.id, anchor: owner?.id ?? null });
  const render = (t: Tok, key: string) => {
    // a folded object: click to open; an open one's `{`: click to fold it again
    const toggle = t.fold ?? t.unfold;
    if (toggle)
      return (
        <span
          key={key}
          className={`rae-tok--${t.k} rae-tok--fold`}
          data-folded={t.fold ? "" : undefined}
          role="button"
          tabIndex={0}
          aria-expanded={!t.fold}
          title={t.fold ? `Show ${plural(t.members ?? 0, "member")}` : "Fold this object"}
          onClick={(e) => {
            e.stopPropagation();
            setToggled((s) => ({ ...s, [toggle]: !t.fold }));
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            setToggled((s) => ({ ...s, [toggle]: !t.fold }));
          }}
        >
          {t.t}
        </span>
      );
    const target = t.k === "type" ? links.get(t.t) : undefined;
    if (!target) return (
      <span key={key} className={`rae-tok--${t.k}`}>
        {t.t}
      </span>
    );
    return (
      <span
        key={key}
        className={`rae-tok--${t.k} rae-tok--link`}
        role="link"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          add(target);
        }}
        onKeyDown={(e) => e.key === "Enter" && add(target)}
      >
        {t.t}
      </span>
    );
  };
  const body = (
    <span ref={ref}>
      <CodeLines lines={lines} render={render} block={block} />
    </span>
  );
  // the type is shown whole: a tooltip only adds the definitions of the types it names
  if (!targets.length || isPrimitiveType(text)) return body;
  return <Tooltip content={<Preview text="" targets={targets} />}>{body}</Tooltip>;
}
