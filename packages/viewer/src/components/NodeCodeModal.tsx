import { Alert, Button, Flex, HStack, Modal, Spinner, Text, textPx } from "@rae/design-system";
import type { GraphNode, NodeId, Snapshot } from "@rae/schema";
import { useEffect, useMemo, useState } from "react";
import { fetchSource } from "../lib/api.ts";
import { codeLinks } from "../lib/codeLinks.ts";
import { sideLabel } from "../lib/diff.ts";
import { displayName } from "../lib/displayName.ts";
import { isWholeFile } from "../lib/nodeDiff.ts";
import { lexSource, type TokLine } from "../lib/syntax.ts";
import { useExplorer } from "../store.ts";
import { CodeNavBar, CodeToken } from "./codeNav.tsx";
import { CodeNavContext } from "./codeNavContext.ts";
import "./syntax.css";
/** Files bigger than this (characters) are shown without colours or links. */
const COLOUR_LIMIT = 400_000;

/** Which version of the file the snapshot describes: a diff's head, a scanned commit, else the working tree. */
function sourceOf(s: Snapshot): { sha: string; label: string } {
  if (s.diff) return { sha: s.diff.head.worktree ? "worktree" : s.diff.head.sha, label: sideLabel(s.diff.head.ref, s.diff.head.sha, s.diff.head.worktree) };
  if (s.commit) return { sha: s.commit.sha, label: sideLabel(s.commit.ref, s.commit.sha) };
  return { sha: "worktree", label: "working tree" };
}

/**
 * A node's code: its declaration's lines (or its whole file), coloured, with line numbers. Names
 * that refer to other elements — what it renders, calls, imports, its types — are links: a click
 * opens that element's code here (components/codeNav.tsx: Back / Forward, Show on diagram).
 */
export function NodeCodeModal({ node, snapshot, onClose }: { node: GraphNode; snapshot: Snapshot; onClose: () => void }) {
  const index = useExplorer((s) => s.index);
  const fileOnly = isWholeFile(node);
  // the whole-file choice is the element's: moving to another starts from its own lines
  const [wholeOf, setWholeOf] = useState<string>();
  const whole = fileOnly || wholeOf === node.id;
  const setWhole = (on: boolean) => setWholeOf(on ? node.id : undefined);
  const source = sourceOf(snapshot);
  const key = `${snapshot.rootDir}|${source.sha}|${node.filePath}`;
  const [state, setState] = useState<{ key: string; text?: string; truncated?: boolean; missing?: boolean; error?: string }>();
  useEffect(() => {
    let live = true;
    fetchSource(snapshot.rootDir, source.sha, node.filePath)
      .then((r) => live && setState({ key, ...r }))
      .catch((e: Error) => live && setState({ key, error: e.message }));
    return () => {
      live = false;
    };
  }, [key, snapshot.rootDir, source.sha, node.filePath]);
  const loaded = state?.key === key ? state : undefined;

  // the whole file is lexed, then cut: comments and strings spanning lines colour right
  const { lines, start } = useMemo(() => {
    const text = loaded?.text;
    if (text === undefined) return { lines: [] as TokLine[], start: 1 };
    const all: TokLine[] = text.length <= COLOUR_LIMIT ? lexSource(text) : text.split("\n").map((t) => [{ k: "plain" as const, t }]);
    if (all.length && all.at(-1)!.length === 0) all.pop();
    if (whole || !node.loc || !node.endLine) return { lines: all, start: 1 };
    return { lines: all.slice(node.loc.line - 1, node.endLine), start: node.loc.line };
  }, [loaded?.text, whole, node]);
  const links = useMemo(() => (index ? codeLinks(snapshot, index, node, whole) : new Map<string, NodeId>()), [snapshot, index, node, whole]);
  const nav = useMemo(() => ({ snapshot, links }), [snapshot, links]);

  const where = `${node.filePath}${!whole && node.loc ? `:${node.loc.line}` : ""}`;
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      size="cover"
      title={
        <Flex gap="3" align="baseline" wrap="wrap">
          <span>{displayName(node)}</span>
          <Text as="span" fontSize="sm" fontWeight="normal" color="fg.muted" fontFamily="mono">
            {where}
          </Text>
          <Text as="span" fontSize="xs" fontWeight="normal" color="fg.subtle">
            {source.label}
          </Text>
        </Flex>
      }
    >
      <CodeNavContext.Provider value={nav}>
      <Flex direction="column" gap="3" h="full" minH="0">
        <HStack gap="3" wrap="wrap">
          <CodeNavBar id={node.id} />
          <Text fontSize="xs" color="fg.subtle" flex="1">
            {links.size ? "Underlined names open what they refer to." : "Nothing in this code refers to other elements of the project."}
          </Text>
          {!fileOnly && (
            <HStack gap="1">
              <Button size="2xs" variant={whole ? "ghost" : "subtle"} rounded="l2" onClick={() => setWhole(false)}>
                {displayName(node)} only
              </Button>
              <Button size="2xs" variant={whole ? "subtle" : "ghost"} rounded="l2" onClick={() => setWhole(true)}>
                Whole file
              </Button>
            </HStack>
          )}
        </HStack>
        {loaded?.error && <Alert status="error" title="Couldn't read the code">{loaded.error}</Alert>}
        {loaded?.missing && <Alert status="warning" title="The file isn't there">{node.filePath} is missing in the {source.label}.</Alert>}
        {!loaded && (
          <HStack gap="2" color="fg.muted">
            <Spinner size="sm" /> <Text>Reading {node.filePath}…</Text>
          </HStack>
        )}
        {loaded?.text !== undefined && (
          <div className="rae-code-view" style={{ fontSize: textPx(12.5) }}>
            {lines.map((line, n) => (
              <div className="rae-code-view__line" key={n}>
                <span className="rae-code-view__no" aria-hidden>
                  {start + n}
                </span>
                <span className="rae-code">
                  {line.map((t, i) => (
                    <CodeToken key={i} tok={t} prev={line[i - 1]} />
                  ))}
                </span>
              </div>
            ))}
            {loaded.truncated && <div className="rae-code-view__more">The file is longer than shown here.</div>}
          </div>
        )}
      </Flex>
      </CodeNavContext.Provider>
    </Modal>
  );
}
