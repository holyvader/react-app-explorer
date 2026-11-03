import { ActionIconButton, Box, Flex, Panel, Text } from "@rae/design-system";
import { IconFolderTree, IconPanelClose, IconPanelOpen } from "@rae/design-system/icons";
import { useCallback, useMemo, useRef } from "react";
import type { TreeNode } from "../graph/tree.ts";
import { TREE_WIDTH, useExplorer } from "../store.ts";
import { ElementTree } from "./picker/ElementTree.tsx";

/**
 * The scanned files as a tree on the left — collapsible (to a thin strip) and resizable, both kept.
 * A row click shows its details (and opens it); on the diagram it's also selected and centred there.
 * The + next to a name, or "Add to diagram" in the details, adds it.
 */
export function FileTree() {
  const snapshot = useExplorer((s) => s.snapshot);
  const open = useExplorer((s) => s.treeOpen);
  const width = useExplorer((s) => s.treeWidth);
  const graph = useExplorer((s) => s.graph);
  const selectedId = useExplorer((s) => s.inspectedId ?? s.selectedId);
  const { setTreeOpen, setTreeWidth } = useExplorer.getState();
  const inputRef = useRef<HTMLInputElement>(null);

  const onDiagram = useMemo(() => new Set(graph.elements.map((e) => e.id)), [graph]);
  const drawn = useCallback((n: TreeNode) => onDiagram.has(n.id ?? n.key), [onDiagram]);
  const add = useCallback((n: TreeNode) => {
    const id = n.id ?? n.key;
    useExplorer.getState().addNodes([id], { select: id, focus: id });
  }, []);
  // a row: its details (on the diagram → selected and centred there; else shown with "Add to diagram")
  const activate = useCallback(
    (n: TreeNode) => {
      if (!n.id && n.kind !== "folder") return; // the Routes / Libraries groups only open
      const id = n.id ?? n.key;
      const st = useExplorer.getState();
      if (onDiagram.has(id)) {
        st.inspect(undefined);
        st.addNodes([id], { select: id, focus: id });
      } else st.inspect(id);
    },
    [onDiagram],
  );

  if (!snapshot) return null;
  if (!open) {
    return (
      <Flex direction="column" align="center" py="2" w="10" flexShrink={0} bg="bg.panel" borderWidth="1px" borderColor="shell.border" rounded="panel" shadow="panel">
        <ActionIconButton label="Show the file tree" icon={<IconPanelOpen />} size="xs" onClick={() => setTreeOpen(true)} />
      </Flex>
    );
  }
  return (
    <Panel resize={{ width, onWidthChange: setTreeWidth, min: 200, max: 560, defaultWidth: TREE_WIDTH, side: "left" }} display="flex" flexDirection="column" overflowY="hidden">
      <Flex align="center" gap="2" pl="4" pr="2" h="11" flexShrink={0}>
        <Box color="fg.muted" display="inline-flex">
          <IconFolderTree size={14} />
        </Box>
        <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" letterSpacing="0.06em" color="fg.muted" flex="1">
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
