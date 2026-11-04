import { Button, Flex, Text } from "@rae/design-system";
import { useRef } from "react";
import type { TreeNode } from "../graph/tree.ts";
import { useExplorer } from "../store.ts";
import { ElementTree } from "./picker/ElementTree.tsx";

export interface ChangesListProps {
  /** A row: its details (and, when drawn, selected on the canvas). */
  onActivate: (node: TreeNode) => void;
  drawn: (node: TreeNode) => boolean;
  /** The + next to a row's name (rows not on the diagram). */
  onAdd: (node: TreeNode) => void;
  selectedId?: string;
}

/**
 * A diff's changes as a tree: the folders and files the branch or pull request touched, each file
 * with its changed elements (and files git didn't change whose elements did), all open at first.
 * Rows open and add like the file tree's (the + puts one on the diagram).
 */
export function ChangesList({ onActivate, drawn, onAdd, selectedId }: ChangesListProps) {
  const diff = useExplorer((s) => s.snapshot?.diff);
  const inputRef = useRef<HTMLInputElement>(null);
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
      <ElementTree mode="browse" changesOnly onActivate={onActivate} drawn={drawn} onAdd={onAdd} selectedId={selectedId} inputRef={inputRef} hideFilter emptyText="No changes under this folder." />
    </>
  );
}
