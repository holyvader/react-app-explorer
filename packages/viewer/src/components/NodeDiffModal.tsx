import { Alert, Button, Flex, HStack, Modal, Spinner, Text } from "@rae/design-system";
import { IconInline, IconSplit } from "@rae/design-system/icons";
import type { GraphNode, Snapshot } from "@rae/schema";
import { Fragment, useMemo, useState } from "react";
import { type DiffLine, foldUnchanged, splitRows } from "../lib/lineDiff.ts";
import { sidesOf, useNodeDiff } from "../lib/nodeDiff.ts";
import { lexSource, type TokLine } from "../lib/syntax.ts";
import "./syntax.css";
import "./nodeDiff.css";

export type DiffMode = "split" | "inline";

/** Files bigger than this (characters) are shown without colours: lexing them would slow the dialog. */
const COLOUR_LIMIT = 400_000;

/** Each side's lines, coloured (by line number − 1), from the whole file: comments and strings spanning lines colour right. */
type Coloured = { before?: TokLine[]; after?: TokLine[] };
const colour = (text: string | undefined) => (text !== undefined && text.length <= COLOUR_LIMIT ? lexSource(text) : undefined);

/** A line's code: coloured when its side was, else as text. */
function Code({ tokens, text }: { tokens?: TokLine; text: string }) {
  if (!tokens) return <>{text || " "}</>;
  if (!tokens.length) return <> </>;
  return (
    <>
      {tokens.map((t, i) => (
        <span key={i} className={`rae-tok--${t.k}`}>
          {t.t}
        </span>
      ))}
    </>
  );
}
const MODE_KEY = "rae.codeDiffMode";

export interface NodeDiffModalProps {
  node: GraphNode;
  snapshot: Snapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The code of one element, before → after: split (side by side) or inline (one column, − / +).
 * The base side is the commit compared against (the merge-base or the base's tip); the head side
 * is the compared commit, or the working tree for uncommitted changes. Files come from git
 * (`git show`), so nothing in the checkout is touched.
 */
export function NodeDiffModal({ node, snapshot, open, onOpenChange }: NodeDiffModalProps) {
  const { before, after, whole } = useMemo(() => sidesOf(snapshot, node), [snapshot, node]);
  const [mode, setMode] = useState<DiffMode>(() => (localStorage.getItem(MODE_KEY) as DiffMode | null) ?? "split");
  const pickMode = (m: DiffMode) => {
    localStorage.setItem(MODE_KEY, m);
    setMode(m);
  };
  const [showAll, setShowAll] = useState(false);

  // both versions from git, and their line diff (shared with the details' "In this diff" header)
  const { diff: loaded, error } = useNodeDiff(snapshot, node, open);
  const lines: DiffLine[] | undefined = loaded?.lines;
  const coloured = useMemo<Coloured>(() => (loaded ? { before: colour(loaded.before), after: colour(loaded.after) } : {}), [loaded]);
  const counts = { add: loaded?.added ?? 0, del: loaded?.removed ?? 0 };

  const title = (
    <Flex align="baseline" gap="2" minW="0">
      <Text truncate>{node.name}</Text>
      <Text as="span" fontFamily="mono" fontSize="12px" color="fg.subtle" fontWeight="normal" truncate>
        {before && after && before.node.filePath !== after.node.filePath ? `${before.node.filePath} → ${after.node.filePath}` : node.filePath}
      </Text>
    </Flex>
  );
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} size="cover">
      <Flex align="center" gap="3" mb="2.5" fontSize="12px" wrap="wrap">
        <Text fontFamily="mono" color="diff.removed.fg">
          − {before?.label ?? "(new)"}
        </Text>
        <Text fontFamily="mono" color="diff.added.fg">
          + {after?.label ?? "(removed)"}
        </Text>
        {lines && (
          <Text fontFamily="mono" color="fg.subtle">
            <Text as="span" color="diff.added.fg">
              +{counts.add}
            </Text>{" "}
            <Text as="span" color="diff.removed.fg">
              −{counts.del}
            </Text>
            {whole ? " · the whole file" : " · the declaration's lines"}
          </Text>
        )}
        <Flex flex="1" />
        <Button size="xs" variant="ghost" rounded="l2" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Fold unchanged lines" : "Show all lines"}
        </Button>
        <HStack gap="0" bg="bg.emphasized" rounded="l2" p="2px" role="radiogroup" aria-label="Diff view">
          <ModeButton on={mode === "split"} onClick={() => pickMode("split")} icon={<IconSplit size={14} />} label="Split" />
          <ModeButton on={mode === "inline"} onClick={() => pickMode("inline")} icon={<IconInline size={14} />} label="Inline" />
        </HStack>
      </Flex>
      {error && (
        <Alert status="error" title="Couldn't read the code">
          {error}
        </Alert>
      )}
      {loaded?.truncated && <Text fontSize="xs" color="fg.muted" mb="2">The file is large: only its first 2 MB are compared.</Text>}
      {!loaded && !error && (
        <Flex align="center" gap="2" color="fg.muted" fontSize="sm" py="6" justify="center">
          <Spinner size="sm" /> Reading both versions from git…
        </Flex>
      )}
      {lines && lines.length === 0 && <Text color="fg.muted">No lines.</Text>}
      {lines && lines.length > 0 && (mode === "split" ? <SplitView lines={lines} coloured={coloured} showAll={showAll} onExpand={() => setShowAll(true)} /> : <InlineView lines={lines} coloured={coloured} showAll={showAll} onExpand={() => setShowAll(true)} />)}
    </Modal>
  );
}

function ModeButton({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <Button size="2xs" variant={on ? "solid" : "ghost"} colorPalette={on ? "accent" : undefined} rounded="l1" role="radio" aria-checked={on} onClick={onClick} gap="1.5">
      {icon} {label}
    </Button>
  );
}

function Fold({ count, cols, onExpand }: { count: number; cols: number; onExpand: () => void }) {
  return (
    <tr className="rae-cdiff__fold">
      <td colSpan={cols}>
        <button type="button" onClick={onExpand}>
          ⋯ {count} unchanged line{count === 1 ? "" : "s"}
        </button>
      </td>
    </tr>
  );
}

function InlineView({ lines, coloured, showAll, onExpand }: { lines: DiffLine[]; coloured: Coloured; showAll: boolean; onExpand: () => void }) {
  const parts = showAll ? [{ type: "rows" as const, rows: lines }] : foldUnchanged(lines, (l) => l.type !== "same");
  return (
    <div className="rae-cdiff" data-mode="inline">
      <table>
        <tbody>
          {parts.map((p, i) =>
            p.type === "fold" ? (
              <Fold key={i} count={p.count} cols={4} onExpand={onExpand} />
            ) : (
              <Fragment key={i}>
                {p.rows.map((l, k) => (
                  <tr key={k} data-type={l.type}>
                    <td className="rae-cdiff__num">{l.type !== "add" ? l.a : ""}</td>
                    <td className="rae-cdiff__num">{l.type !== "del" ? l.b : ""}</td>
                    <td className="rae-cdiff__sign">{l.type === "add" ? "+" : l.type === "del" ? "−" : ""}</td>
                    <td className="rae-cdiff__code">
                      <Code tokens={l.type === "del" ? coloured.before?.[l.a - 1] : coloured.after?.[l.b - 1]} text={l.text} />
                    </td>
                  </tr>
                ))}
              </Fragment>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function SplitView({ lines, coloured, showAll, onExpand }: { lines: DiffLine[]; coloured: Coloured; showAll: boolean; onExpand: () => void }) {
  const rows = useMemo(() => splitRows(lines), [lines]);
  const parts = showAll ? [{ type: "rows" as const, rows }] : foldUnchanged(rows, (r) => r.left?.type === "del" || r.right?.type === "add");
  return (
    <div className="rae-cdiff" data-mode="split">
      <table>
        <colgroup>
          <col className="rae-cdiff__numcol" />
          <col />
          <col className="rae-cdiff__numcol" />
          <col />
        </colgroup>
        <tbody>
          {parts.map((p, i) =>
            p.type === "fold" ? (
              <Fold key={i} count={p.count} cols={4} onExpand={onExpand} />
            ) : (
              <Fragment key={i}>
                {p.rows.map((r, k) => (
                  <tr key={k}>
                    <td className="rae-cdiff__num" data-type={r.left?.type ?? "empty"}>
                      {r.left?.a ?? ""}
                    </td>
                    <td className="rae-cdiff__code" data-type={r.left?.type ?? "empty"}>
                      {r.left ? <Code tokens={coloured.before?.[r.left.a - 1]} text={(r.left.type === "same" && r.left.was) || r.left.text} /> : ""}
                    </td>
                    <td className="rae-cdiff__num" data-type={r.right?.type ?? "empty"}>
                      {r.right?.b ?? ""}
                    </td>
                    <td className="rae-cdiff__code" data-type={r.right?.type ?? "empty"}>
                      {r.right ? <Code tokens={coloured.after?.[r.right.b - 1]} text={r.right.text} /> : ""}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
