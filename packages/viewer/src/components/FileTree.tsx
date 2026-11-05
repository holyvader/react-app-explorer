import { ActionIconButton, Flex, Panel, PanelBar, Text, textPx } from "@rae/design-system";
import { IconDiff, IconFilter, IconPanelClose, IconPanelOpen } from "@rae/design-system/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TreeNode } from "../graph/tree.ts";
import { TREE_WIDTH, useExplorer } from "../store.ts";
import { ChangesList } from "./ChangesList.tsx";
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
  const [filtering, setFiltering] = useState(false);
  // diff snapshots: the changes, file by file, instead of the whole tree (shown first)
  const [changesView, setChangesView] = useState(true);
  const showChanges = !!snapshot?.diff && changesView;
  useEffect(() => {
    if (filtering) inputRef.current?.focus();
  }, [filtering]);

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
      } else {
        // its details replace the diagram's selection (cleared first: a selection change ends an inspection)
        st.select(undefined);
        st.inspect(id);
      }
    },
    [onDiagram],
  );

  if (!snapshot) return null;
  return (
    <Panel
      resize={{ width, onWidthChange: setTreeWidth, min: 200, max: 560, defaultWidth: TREE_WIDTH, side: "left" }}
      collapse={{
        collapsed: !open,
        strip: (
          <Flex direction="column" align="center" py="1" h="full" cursor="pointer" onClick={() => setTreeOpen(true)} _hover={{ bg: "bg.subtle" }}>
            <ActionIconButton
              label="Show the file tree"
              icon={<IconPanelOpen />}
              size="2xs"
              color="fg.subtle"
              onClick={(e) => {
                e.stopPropagation();
                setTreeOpen(true);
              }}
            />
          </Flex>
        ),
      }}
      display="flex"
      flexDirection="column"
      overflowY="hidden"
    >
      <PanelBar label={showChanges ? "Changes" : "Files"}>
        {snapshot.diff && (
          <ActionIconButton
            label={showChanges ? "Show all files" : "Show the changes"}
            icon={<IconDiff />}
            size="2xs"
            color={showChanges ? "fg" : "fg.subtle"}
            bg={showChanges ? "bg.muted" : undefined}
            aria-pressed={showChanges}
            onClick={() => setChangesView(!changesView)}
          />
        )}
        {!showChanges && (
          <ActionIconButton
            label={filtering ? "Stop filtering" : "Filter files"}
            icon={<IconFilter />}
            size="2xs"
            color={filtering ? "fg" : "fg.subtle"}
            bg={filtering ? "bg.muted" : undefined}
            aria-pressed={filtering}
            onClick={() => setFiltering(!filtering)}
          />
        )}
        <ActionIconButton label="Hide the file tree" icon={<IconPanelClose />} size="2xs" color="fg.subtle" onClick={() => setTreeOpen(false)} />
      </PanelBar>
      <Flex
        direction="column"
        flex="1"
        minH="0"
        className="rae-filetree"
        onKeyDown={(e) => {
          if (e.key === "Escape" && filtering) setFiltering(false);
        }}
      >
        {showChanges ? (
          <ChangesList onActivate={activate} drawn={drawn} onAdd={add} selectedId={selectedId} />
        ) : (
          <ElementTree mode="browse" onActivate={activate} drawn={drawn} onAdd={add} selectedId={selectedId} inputRef={inputRef} placeholder="Filter files…" hideFilter={!filtering} />
        )}
      </Flex>
      {/* what was scanned, quietly */}
      <Flex align="center" h="28px" px="3" flexShrink={0} borderTopWidth="1px" borderColor="border.muted">
        <Text fontFamily="mono" fontSize={textPx(10.5)} color="fg.subtle" truncate>
          {snapshot.stats.files} files · {Object.keys(snapshot.nodes).length} el · types {snapshot.stats.types ? "✓" : "–"} · {Math.round(snapshot.stats.durationMs)}ms
        </Text>
      </Flex>
    </Panel>
  );
}
