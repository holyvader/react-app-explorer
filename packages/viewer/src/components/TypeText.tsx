import { Box, Text, Tooltip } from "@rae/design-system";
import type { GraphNode, Snapshot } from "@rae/schema";
import { Fragment, type ReactNode } from "react";
import { useExplorer } from "../store.ts";

const IDENT = /[A-Za-z_$][\w$]*/g;
/** Lines of a definition shown in a tooltip before "…". */
const PREVIEW_LINES = 24;

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

const clip = (text: string) => {
  const lines = text.split("\n");
  return lines.length > PREVIEW_LINES ? [...lines.slice(0, PREVIEW_LINES), "…"].join("\n") : text;
};

function Preview({ text, targets }: { text: string; targets: GraphNode[] }) {
  return (
    <Box maxW="min(560px, 80vw)">
      {text && (
        <Box as="pre" fontFamily="mono" fontSize="2xs" whiteSpace="pre-wrap" wordBreak="break-word" m="0">
          {text}
        </Box>
      )}
      {targets.map((t, i) => (
        <Box key={t.id} mt={text || i ? "2.5" : 0} pt={text || i ? "2" : 0} borderTopWidth={text || i ? "1px" : 0} borderColor="whiteAlpha.300">
          <Text fontSize="2xs" opacity={0.75} mb="1">
            {t.kind === "type" ? `${t.typeKind ?? "type"} · ${t.filePath}` : `from ${t.name}`} — click the name to add it
          </Text>
          {t.typeText && (
            <Box as="pre" fontFamily="mono" fontSize="2xs" whiteSpace="pre-wrap" wordBreak="break-word" m="0">
              {clip(t.typeText)}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

/**
 * A TypeScript type as text: hover for a tooltip with the whole type and the definitions of the
 * project types it names; those names are links that add the type (or library) to the diagram.
 * `owner` is the node whose annotation this is (its `typeRefs` say what each name resolves to).
 */
export function TypeText({ text, owner, block }: { text: string; owner?: GraphNode; block?: boolean }) {
  const snapshot = useExplorer((s) => s.snapshot);
  if (!snapshot) return <>{text}</>;

  const parts: ReactNode[] = [];
  const targets = new Map<string, GraphNode>();
  let last = 0;
  for (const m of text.matchAll(IDENT)) {
    const name = m[0];
    const target = targetOf(snapshot, owner, name);
    if (!target || target.id === owner?.id) continue;
    if (target.kind === "type" || target.kind === "external") targets.set(target.id, target);
    parts.push(text.slice(last, m.index));
    parts.push(
      <Box
        key={`${m.index}-${name}`}
        as="span"
        role="link"
        tabIndex={0}
        textDecoration="underline dotted"
        textUnderlineOffset="3px"
        cursor="pointer"
        _hover={{ color: "kind.type.fg", textDecorationStyle: "solid" }}
        onClick={(e) => {
          e.stopPropagation();
          useExplorer.getState().addNodes([target.id], { select: target.id, focus: target.id, anchor: owner?.id ?? null });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") useExplorer.getState().addNodes([target.id], { select: target.id, focus: target.id, anchor: owner?.id ?? null });
        }}
      >
        {name}
      </Box>,
    );
    last = m.index + name.length;
  }
  parts.push(text.slice(last));

  const body = (
    <Box as="span" color="syntax.type" whiteSpace={block ? "pre-wrap" : undefined} wordBreak={block ? "break-word" : undefined} cursor="help">
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </Box>
  );
  // block definitions are already shown in full; inline types get the full-text tooltip
  if (block && targets.size === 0) return body;
  return <Tooltip content={<Preview text={block ? "" : text} targets={[...targets.values()]} />}>{body}</Tooltip>;
}
