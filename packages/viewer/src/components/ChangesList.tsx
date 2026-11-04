import { Button, Flex, Text } from "@rae/design-system";
import type { GraphNode, SnapshotDiff } from "@rae/schema";
import { useMemo } from "react";
import { CHANGE_LETTER, CHANGE_WORD } from "../lib/diff.ts";
import { KIND_META } from "../lib/kinds.tsx";
import { useExplorer } from "../store.ts";

type FileStatus = SnapshotDiff["files"][number]["status"];
const FILE_LETTER: Record<FileStatus, string> = { added: "A", modified: "M", deleted: "D", renamed: "R" };
const FILE_CHANGE: Record<FileStatus, string> = { added: "added", modified: "changed", deleted: "removed", renamed: "changed" };

export interface ChangesListProps {
  /** A row: its details (and, when drawn, selected on the canvas). */
  onActivate: (id: string) => void;
  drawn: (id: string) => boolean;
  selectedId?: string;
}

/**
 * A diff's changes, file by file (as git lists them), each with its changed declarations: what the
 * branch or pull request touched, in order. Rows open like the file tree's.
 */
export function ChangesList({ onActivate, drawn, selectedId }: ChangesListProps) {
  const snapshot = useExplorer((s) => s.snapshot);
  const diff = snapshot?.diff;
  const groups = useMemo(() => {
    if (!snapshot || !diff) return [];
    // changed nodes by their file
    const byFile = new Map<string, { id: string; node: GraphNode; change: keyof typeof CHANGE_LETTER }[]>();
    for (const [id, change] of Object.entries(diff.nodes)) {
      const node = snapshot.nodes[id];
      if (!node || node.kind === "module" || node.kind === "external" || node.kind === "route") continue;
      const list = byFile.get(node.filePath) ?? [];
      list.push({ id, node, change });
      byFile.set(node.filePath, list);
    }
    for (const list of byFile.values()) list.sort((a, b) => (a.node.loc?.line ?? 0) - (b.node.loc?.line ?? 0));
    const listed = new Set(diff.files.map((f) => f.path));
    // files git didn't change whose elements did (server ↔ client through an importer, a route's rendering…)
    const others = [...byFile.keys()].filter((p) => !listed.has(p)).map((path) => ({ path, status: "modified" as const, from: undefined as string | undefined, additions: 0, deletions: 0, untouched: true }));
    return [...diff.files, ...others].map((f) => {
      // the file's own node: a module, or a declaration standing for it (merged), or its ghost
      const fileNode = snapshot.nodes[f.path] ?? (f.status === "deleted" ? diff.removed[f.path] : undefined);
      return { file: f, untouched: "untouched" in f, fileId: fileNode ? fileNode.id : undefined, decls: fileNode?.file ? [] : (byFile.get(f.path) ?? []) };
    });
  }, [snapshot, diff]);

  if (!diff) return null;
  const counts = { added: 0, changed: 0, removed: 0 };
  for (const c of Object.values(diff.nodes)) counts[c]++;
  return (
    <>
      <Flex align="center" gap="2" px="3" py="2" borderBottomWidth="1px" borderColor="border.muted" fontSize="12px">
        <Text color="fg.muted" flex="1" truncate>
          {diff.files.length} files ·{" "}
          <Text as="span" color="diff.added.fg">
            +{counts.added}
          </Text>{" "}
          <Text as="span" color="diff.changed.fg">
            ~{counts.changed}
          </Text>{" "}
          <Text as="span" color="diff.removed.fg">
            −{counts.removed}
          </Text>
        </Text>
        <Button size="2xs" variant="outline" rounded="l2" onClick={() => useExplorer.getState().showChanges()}>
          Show on canvas
        </Button>
      </Flex>
      <div className="rae-tree" role="tree" aria-label="Changes">
        {groups.length === 0 && <div className="rae-tree__empty">No changes under this folder.</div>}
        {groups.map(({ file, fileId, decls, untouched }) => {
          const fileNode = fileId ? (snapshot!.nodes[fileId] ?? diff.removed[fileId]) : undefined;
          const FileIcon = KIND_META[fileNode?.kind ?? "module"].icon;
          return (
            <div key={file.path} role="group">
              <Row
                id={fileId}
                depth={0}
                icon={<FileIcon size={14} />}
                kind={fileNode?.kind ?? "module"}
                name={fileNode?.file ? fileNode.name : file.path}
                title={file.from ? `${file.from} → ${file.path}` : file.path}
                letter={untouched ? "" : FILE_LETTER[file.status]}
                change={untouched ? "dir" : FILE_CHANGE[file.status]}
                note={untouched ? "unchanged file" : `+${file.additions} −${file.deletions}`}
                onActivate={onActivate}
                drawn={drawn}
                selectedId={selectedId}
              />
              {decls.map((d) => {
                const Icon = KIND_META[d.node.kind].icon;
                return (
                  <Row
                    key={d.id}
                    id={d.id}
                    depth={1}
                    icon={<Icon size={14} />}
                    kind={d.node.kind}
                    name={d.node.name}
                    title={`${d.node.name} — ${CHANGE_WORD[d.change]}`}
                    letter={CHANGE_LETTER[d.change]}
                    change={d.change}
                    onActivate={onActivate}
                    drawn={drawn}
                    selectedId={selectedId}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Row(props: {
  id?: string;
  depth: number;
  icon: React.ReactNode;
  kind: string;
  name: string;
  title: string;
  letter: string;
  change: string;
  note?: string;
  onActivate: (id: string) => void;
  drawn: (id: string) => boolean;
  selectedId?: string;
}) {
  const { id } = props;
  return (
    <button
      type="button"
      role="treeitem"
      className="rae-tree__row"
      data-inactive={id ? undefined : ""}
      data-drawn={id && props.drawn(id) ? "" : undefined}
      data-selected={id && id === props.selectedId ? "" : undefined}
      style={{ paddingLeft: 10 + props.depth * 14 }}
      title={props.title}
      onClick={() => id && props.onActivate(id)}
    >
      <span className="rae-tree__icon" data-kind={props.kind}>
        {props.icon}
      </span>
      <span className="rae-tree__name" data-change={props.change}>
        {props.name}
      </span>
      <span className="rae-tree__change" data-change={props.change}>
        {props.letter}
      </span>
      {props.note && <span className="rae-tree__note">{props.note}</span>}
    </button>
  );
}
