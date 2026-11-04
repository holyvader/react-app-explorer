import { Alert, Button, Flex, HStack, Modal, Spinner, Text } from "@rae/design-system";
import { IconInline, IconSplit } from "@rae/design-system/icons";
import type { GraphNode, Snapshot } from "@rae/schema";
import { Fragment, useEffect, useMemo, useState } from "react";
import { fetchSource } from "../lib/api.ts";
import { type DiffLine, diffLines, foldUnchanged, splitRows } from "../lib/lineDiff.ts";
import "./nodeDiff.css";

export type DiffMode = "split" | "inline";
const MODE_KEY = "rae.codeDiffMode";

export interface NodeDiffModalProps {
  node: GraphNode;
  snapshot: Snapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** One side of the diff: which commit, which file, which lines (a declaration's, or the whole file). */
interface Side {
  sha: string;
  label: string;
  node: GraphNode;
  whole: boolean;
}

/** The lines a node covers in its file's text: a declaration's (loc → endLine), else the whole file. */
function linesOf(text: string, side: Side): { lines: string[]; start: number } {
  const all = text.split("\n");
  if (all.length && all[all.length - 1] === "") all.pop();
  const { loc, endLine } = side.node;
  if (side.whole || !loc || !endLine) return { lines: all, start: 1 };
  // from the line its name is on (where the scanner places it) to its last line
  const from = Math.max(1, loc.line);
  return { lines: all.slice(from - 1, endLine), start: from };
}

/**
 * The code of one element, before → after: split (side by side) or inline (one column, − / +).
 * The base side is the commit compared against (the merge-base or the base's tip); the head side
 * is the compared commit, or the working tree for uncommitted changes. Files come from git
 * (`git show`), so nothing in the checkout is touched.
 */
export function NodeDiffModal({ node, snapshot, open, onOpenChange }: NodeDiffModalProps) {
  const diff = snapshot.diff!;
  const change = diff.nodes[node.id];
  const whole = node.kind === "module" || !!node.file;
  const before: Side | undefined = useMemo(() => {
    const was = change === "changed" ? diff.before[node.id] : change === "removed" ? node : undefined;
    return was ? { sha: diff.compared, label: `${diff.base.ref} ${diff.compared.slice(0, 7)}`, node: was, whole } : undefined;
  }, [change, diff, node, whole]);
  const after: Side | undefined = useMemo(
    () => (change === "removed" ? undefined : { sha: diff.head.worktree ? "worktree" : diff.head.sha, label: diff.head.worktree ? `${diff.head.ref} + uncommitted` : `${diff.head.ref} ${diff.head.sha.slice(0, 7)}`, node, whole }),
    [change, diff, node, whole],
  );

  const [mode, setMode] = useState<DiffMode>(() => (localStorage.getItem(MODE_KEY) as DiffMode | null) ?? "split");
  const pickMode = (m: DiffMode) => {
    localStorage.setItem(MODE_KEY, m);
    setMode(m);
  };
  const [showAll, setShowAll] = useState(false);

  // both texts (an external system: the server reads them from git)
  const [texts, setTexts] = useState<{ key: string; before?: string; after?: string; error?: string; truncated?: boolean }>();
  const key = `${node.id}|${before?.sha ?? ""}|${after?.sha ?? ""}`;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const read = (side?: Side) => (side ? fetchSource(snapshot.rootDir, side.sha, side.node.filePath) : Promise.resolve(undefined));
    Promise.all([read(before), read(after)])
      .then(([b, a]) => !cancelled && setTexts({ key, before: b?.text, after: a?.text, truncated: b?.truncated || a?.truncated }))
      .catch((e: Error) => !cancelled && setTexts({ key, error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [open, key, before, after, snapshot.rootDir]);
  const loaded = texts?.key === key ? texts : undefined;

  const lines = useMemo<DiffLine[] | undefined>(() => {
    if (!loaded || loaded.error) return undefined;
    const b = before && loaded.before !== undefined ? linesOf(loaded.before, before) : { lines: [], start: 1 };
    const a = after && loaded.after !== undefined ? linesOf(loaded.after, after) : { lines: [], start: 1 };
    return diffLines(b.lines, a.lines, b.start, a.start);
  }, [loaded, before, after]);
  const counts = useMemo(() => ({ add: lines?.filter((l) => l.type === "add").length ?? 0, del: lines?.filter((l) => l.type === "del").length ?? 0 }), [lines]);

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
      {loaded?.error && (
        <Alert status="error" title="Couldn't read the code">
          {loaded.error}
        </Alert>
      )}
      {loaded?.truncated && <Text fontSize="xs" color="fg.muted" mb="2">The file is large: only its first 2 MB are compared.</Text>}
      {!loaded && (
        <Flex align="center" gap="2" color="fg.muted" fontSize="sm" py="6" justify="center">
          <Spinner size="sm" /> Reading both versions from git…
        </Flex>
      )}
      {lines && lines.length === 0 && <Text color="fg.muted">No lines.</Text>}
      {lines && lines.length > 0 && (mode === "split" ? <SplitView lines={lines} showAll={showAll} onExpand={() => setShowAll(true)} /> : <InlineView lines={lines} showAll={showAll} onExpand={() => setShowAll(true)} />)}
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

function InlineView({ lines, showAll, onExpand }: { lines: DiffLine[]; showAll: boolean; onExpand: () => void }) {
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
                    <td className="rae-cdiff__code">{l.text || " "}</td>
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

function SplitView({ lines, showAll, onExpand }: { lines: DiffLine[]; showAll: boolean; onExpand: () => void }) {
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
                      {r.left ? r.left.text || " " : ""}
                    </td>
                    <td className="rae-cdiff__num" data-type={r.right?.type ?? "empty"}>
                      {r.right?.b ?? ""}
                    </td>
                    <td className="rae-cdiff__code" data-type={r.right?.type ?? "empty"}>
                      {r.right ? r.right.text || " " : ""}
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
