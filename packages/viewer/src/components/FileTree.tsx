import { ActionIconButton, Box, Flex, Panel, Text } from "@rae/design-system";
import { IconFolderTree, IconPanelClose, IconPanelOpen } from "@rae/design-system/icons";
import { useCallback, useMemo, useRef } from "react";
import type { TreeNode } from "../graph/tree.ts";
import { TREE_WIDTH, useExplorer } from "../store.ts";
import { ElementTree } from "./picker/ElementTree.tsx";

/**
 * The scanned files as a tree on the left — collapsible (to a thin strip) and resizable, both kept.
 * Click a row to open it, or go to it when it's on the diagram; its + adds it to the diagram.
 */
export function FileTree() {
  const snapshot = useExplorer((s) => s.snapshot);
  const open = useExplorer((s) => s.treeOpen);
  const width = useExplorer((s) => s.treeWidth);
  const graph = useExplorer((s) => s.graph);
  const selectedId = useExplorer((s) => s.selectedId);
  const { setTreeOpen, setTreeWidth } = useExplorer.getState();
  const inputRef = useRef<HTMLInputElement>(null);

  const onDiagram = useMemo(() => new Set(graph.elements.map((e) => e.id)), [graph]);
  const drawn = useCallback((n: TreeNode) => onDiagram.has(n.id ?? n.key), [onDiagram]);
  const add = useCallback((n: TreeNode) => {
    const id = n.id ?? n.key;
    useExplorer.getState().addNodes([id], { select: id, focus: id });
  }, []);
  // a row: on the diagram → go to it; else nothing (the tree opens / closes it)
  const activate = useCallback(
    (n: TreeNode) => {
      const id = n.id ?? n.key;
      if (onDiagram.has(id)) useExplorer.getState().addNodes([id], { select: id, focus: id });
    },
    [onDiagram],
  );

  if (!snapshot) return null;
  if (!open) {
    return (
      <Flex direction="column" align="center" py="2" w="9" flexShrink={0} bg="bg.panel" borderRightWidth="1px" borderColor="border.muted">
        <ActionIconButton label="Show the file tree" icon={<IconPanelOpen />} size="xs" onClick={() => setTreeOpen(true)} />
      </Flex>
    );
  }
  return (
    <Panel resize={{ width, onWidthChange: setTreeWidth, min: 200, max: 560, defaultWidth: TREE_WIDTH, side: "left" }} display="flex" flexDirection="column" overflowY="hidden">
      <Flex align="center" gap="2" px="3" h="10" flexShrink={0} borderBottomWidth="1px" borderColor="border.muted">
        <Box color="fg.muted" display="inline-flex">
          <IconFolderTree size={14} />
        </Box>
        <Text fontSize="sm" fontWeight="semibold" flex="1">
          Files
        </Text>
        <ActionIconButton label="Hide the file tree" icon={<IconPanelClose />} size="2xs" variant="ghost" onClick={() => setTreeOpen(false)} />
      </Flex>
      <Flex direction="column" flex="1" minH="0" className="rae-filetree">
        <ElementTree mode="browse" onActivate={activate} drawn={drawn} onAdd={add} selectedId={selectedId} inputRef={inputRef} placeholder="Filter files…" />
      </Flex>
    </Panel>
  );
}
