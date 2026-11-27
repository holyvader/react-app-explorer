import { Alert, Button, Flex, HStack, Modal, Spinner, Text, textPx } from "@rae/design-system";
import { IconInline, IconSplit } from "@rae/design-system/icons";
import type { GraphNode, ReviewThread, Snapshot } from "@rae/schema";
import { Fragment, useMemo, useState } from "react";
import { type DiffLine, foldUnchanged, splitRows } from "../lib/lineDiff.ts";
import { type Coloured, isWholeFile, sidesOf, useColoured, useNodeDiff } from "../lib/nodeDiff.ts";
import { DiffCode, InlineRow } from "./DiffCode.tsx";
import { usePersistentState } from "../lib/settings.ts";
import { plural } from "../lib/text.ts";
import { displayName } from "../lib/displayName.ts";
import { codeLinks } from "../lib/codeLinks.ts";
import { useExplorer } from "../store.ts";
import { CodeNavBar } from "./codeNav.tsx";
import { CodeNavContext } from "./codeNavContext.ts";
import { useReview } from "../lib/review.ts";
import { ReviewThreadView } from "./review/ReviewThreads.tsx";

/** Review threads by where they sit: `new:<head line>` / `old:<base line>`. */
type ThreadsAt = (keys: string[]) => ReviewThread[];
const NO_THREADS: ThreadsAt = () => [];
/** A diff line's places: its head line (not for a removed one), its base line (not for an added one). */
const keysOf = (l: DiffLine | undefined): string[] => (!l ? [] : [...(l.type !== "del" ? [`new:${l.b}`] : []), ...(l.type !== "add" ? [`old:${l.a}`] : [])]);

const ThreadList = ({ threads }: { threads: ReviewThread[] }) => (
  <Flex direction="column" gap="2">
    {threads.map((t) => (
      <ReviewThreadView key={t.id} thread={t} />
    ))}
  </Flex>
);

/** The review threads under a line: across the inline table; in a split one, under their side (base left, head right). */
function ThreadRows({ threads, cols, split }: { threads: ReviewThread[]; cols: number; split?: boolean }) {
  if (!threads.length) return null;
  if (!split)
    return (
      <tr className="rae-cdiff__thread">
        <td colSpan={cols}>
          <ThreadList threads={threads} />
        </td>
      </tr>
    );
  const left = threads.filter((t) => t.side === "old");
  const right = threads.filter((t) => t.side === "new");
  return (
    <tr className="rae-cdiff__thread" data-split="">
      <td colSpan={2}>{left.length > 0 && <ThreadList threads={left} />}</td>
      <td colSpan={2}>{right.length > 0 && <ThreadList threads={right} />}</td>
    </tr>
  );
}

export type DiffMode = "split" | "inline";

const MODE_KEY = "rae.codeDiffMode";
/** A declaration's diff: its own lines, or its whole file (remembered). */
const SCOPE_KEY = "rae.codeDiffScope";
type Scope = "declaration" | "file";

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
  const [scope, pickScope] = usePersistentState<Scope>(SCOPE_KEY, "declaration");
  // modules and merged files are a whole file anyway: no choice to make
  const declaration = !isWholeFile(node);
  const wholeFile = declaration && scope === "file";
  const { before, after, whole } = useMemo(() => sidesOf(snapshot, node, wholeFile), [snapshot, node, wholeFile]);
  const [mode, pickMode] = usePersistentState<DiffMode>(MODE_KEY, "split");
  const [showAll, setShowAll] = useState(false);

  // both versions from git, and their line diff (shared with the details' "In this diff" header)
  const { diff: loaded, error } = useNodeDiff(snapshot, node, open, wholeFile);
  const lines: DiffLine[] | undefined = loaded?.lines;
  const coloured = useColoured(loaded);
  // the request's review threads on this file: under their line; the rest of this element's above the code
  const allThreads = useReview((s) => s.threads);
  const mine = useReview((s) => s.byNode.get(node.id));
  const review = useMemo(() => {
    const onFile = allThreads.filter((t) => t.path === node.filePath);
    const at = new Map<string, ReviewThread[]>();
    for (const t of onFile) if (t.line && !t.outdated) at.set(`${t.side}:${t.line}`, [...(at.get(`${t.side}:${t.line}`) ?? []), t]);
    const shown = new Set((lines ?? []).flatMap(keysOf));
    const placed = new Set(onFile.filter((t) => t.line && !t.outdated && shown.has(`${t.side}:${t.line}`)));
    const elsewhere = (whole ? onFile : (mine ?? [])).filter((t) => !placed.has(t));
    const threadsAt: ThreadsAt = (keys) => [...new Set(keys.flatMap((k) => at.get(k) ?? []))];
    return { threadsAt: at.size ? threadsAt : NO_THREADS, elsewhere };
  }, [allThreads, mine, node.filePath, lines, whole]);
  const counts = { add: loaded?.added ?? 0, del: loaded?.removed ?? 0 };
  // names in the code lead on, in this dialog (components/codeNav.tsx)
  const index = useExplorer((s) => s.index);
  const nav = useMemo(() => ({ snapshot, links: index ? codeLinks(snapshot, index, node, whole) : new Map<string, string>() }), [snapshot, index, node, whole]);

  const title = (
    <Flex align="baseline" gap="2" minW="0">
      <Text truncate>{displayName(node)}</Text>
      <Text as="span" fontFamily="mono" fontSize={textPx(12)} color="fg.subtle" fontWeight="normal" truncate>
        {before && after && before.node.filePath !== after.node.filePath ? `${before.node.filePath} → ${after.node.filePath}` : node.filePath}
      </Text>
    </Flex>
  );
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} size="cover">
      <CodeNavContext.Provider value={nav}>
      <Flex align="center" gap="3" mb="2.5" fontSize={textPx(12)} wrap="wrap">
        <CodeNavBar id={node.id} />
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
            {!declaration && whole && " · the whole file"}
          </Text>
        )}
        <Flex flex="1" />
        {declaration && (
          <HStack gap="0" bg="bg.emphasized" rounded="l2" p="2px" role="radiogroup" aria-label="What to compare">
            <ModeButton on={!wholeFile} onClick={() => pickScope("declaration")} label={`${node.name} only`} />
            <ModeButton on={wholeFile} onClick={() => pickScope("file")} label="Whole file" />
          </HStack>
        )}
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
      {review.elsewhere.length > 0 && (
        <div className="rae-cdiff-elsewhere" aria-label="Review comments not on these lines">
          <Text fontSize="xs" color="fg.muted">
            Review comments not on these lines
          </Text>
          {review.elsewhere.map((t) => (
            <ReviewThreadView key={t.id} thread={t} where />
          ))}
        </div>
      )}
      {lines && lines.length === 0 && <Text color="fg.muted">No lines.</Text>}
      {lines && lines.length > 0 && (mode === "split" ? <SplitView lines={lines} coloured={coloured} showAll={showAll} onExpand={() => setShowAll(true)} threadsAt={review.threadsAt} /> : <InlineView lines={lines} coloured={coloured} showAll={showAll} onExpand={() => setShowAll(true)} threadsAt={review.threadsAt} />)}
      </CodeNavContext.Provider>
    </Modal>
  );
}

function ModeButton({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon?: React.ReactNode; label: string }) {
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
          ⋯ {count} unchanged {plural(count, "line", { word: true })}
        </button>
      </td>
    </tr>
  );
}

function InlineView({ lines, coloured, showAll, onExpand, threadsAt }: { lines: DiffLine[]; coloured: Coloured; showAll: boolean; onExpand: () => void; threadsAt: ThreadsAt }) {
  // lines with a review thread stay in sight, like changed ones
  const parts = showAll ? [{ type: "rows" as const, rows: lines }] : foldUnchanged(lines, (l) => l.type !== "same" || threadsAt(keysOf(l)).length > 0);
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
                  <Fragment key={k}>
                    <InlineRow line={l} coloured={coloured} />
                    <ThreadRows threads={threadsAt(keysOf(l))} cols={4} />
                  </Fragment>
                ))}
              </Fragment>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function SplitView({ lines, coloured, showAll, onExpand, threadsAt }: { lines: DiffLine[]; coloured: Coloured; showAll: boolean; onExpand: () => void; threadsAt: ThreadsAt }) {
  const rows = useMemo(() => splitRows(lines), [lines]);
  const at = (r: (typeof rows)[number]) => threadsAt([...keysOf(r.right), ...keysOf(r.left)]);
  const parts = showAll ? [{ type: "rows" as const, rows }] : foldUnchanged(rows, (r) => r.left?.type === "del" || r.right?.type === "add" || at(r).length > 0);
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
                  <Fragment key={k}>
                  <tr>
                    <td className="rae-cdiff__num" data-type={r.left?.type ?? "empty"}>
                      {r.left?.a ?? ""}
                    </td>
                    <td className="rae-cdiff__code" data-type={r.left?.type ?? "empty"}>
                      {r.left ? <DiffCode tokens={coloured.before?.[r.left.a - 1]} text={(r.left.type === "same" && r.left.was) || r.left.text} /> : ""}
                    </td>
                    <td className="rae-cdiff__num" data-type={r.right?.type ?? "empty"}>
                      {r.right?.b ?? ""}
                    </td>
                    <td className="rae-cdiff__code" data-type={r.right?.type ?? "empty"}>
                      {r.right ? <DiffCode tokens={coloured.after?.[r.right.b - 1]} text={r.right.text} /> : ""}
                    </td>
                  </tr>
                  <ThreadRows threads={at(r)} cols={4} split />
                  </Fragment>
                ))}
              </Fragment>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
