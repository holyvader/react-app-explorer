import { ActionIconButton, Button, ContextMenu, Flex, Kbd, Panel, PanelBar, Text, textPx } from "@rae/design-system";
import { IconDiff, IconFilter, IconPanelClose, IconPanelOpen } from "@rae/design-system/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TreeNode } from "../graph/tree.ts";
import { TREE_WIDTH, useExplorer } from "../store.ts";
import { ChangesList } from "./ChangesList.tsx";
import { ElementTree } from "./picker/ElementTree.tsx";
import { routesEntry, treeMenuEntries } from "./treeMenu.tsx";

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
  // rows picked to add together (⌘ / ⇧-click), then added at once from the bar at the foot (or ⏎)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const onPick = useCallback((keys: string[], how: "toggle" | "range" | "clear") => {
    setPicked((prev) => {
      if (how === "clear") return new Set();
      const next = new Set(prev);
      for (const k of keys) {
        if (how === "range" || !next.has(k)) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }, []);
  const addPicked = useCallback(() => {
    if (!picked.size) return;
    useExplorer.getState().requestAdd([...picked], `${picked.size} elements from the tree`);
    setPicked(new Set());
  }, [picked]);
  // a row's right-click menu (or the panel's own, off the rows: just the routes)
  const [menu, setMenu] = useState<{ node?: TreeNode; at: { x: number; y: number } } | null>(null);
  const onRowMenu = useCallback((node: TreeNode, at: { x: number; y: number }) => setMenu({ node, at }), []);
  const menuEntries = useMemo(() => {
    if (!menu) return [];
    if (menu.node) return treeMenuEntries(menu.node, showChanges);
    const routes = routesEntry(showChanges);
    return routes ? [routes] : [];
  }, [menu, showChanges]);
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
        onContextMenu={(e) => {
          // off the rows (they open their own): the routes
          if (e.defaultPrevented || !routesEntry(showChanges)) return;
          e.preventDefault();
          setMenu({ at: { x: e.clientX, y: e.clientY } });
        }}
        onKeyDownCapture={(e) => {
          // with rows picked, ⏎ adds them (not the focused row's own action), Esc lets them go
          if (!picked.size || (e.target as HTMLElement).matches("input")) return;
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            addPicked();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setPicked(new Set());
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && filtering) setFiltering(false);
        }}
      >
        {showChanges ? (
          <ChangesList onActivate={activate} drawn={drawn} onAdd={add} selectedId={selectedId} onRowMenu={onRowMenu} picked={picked} onPick={onPick} />
        ) : (
          <ElementTree mode="browse" onActivate={activate} drawn={drawn} onAdd={add} selectedId={selectedId} onRowMenu={onRowMenu} picked={picked} onPick={onPick} inputRef={inputRef} placeholder="Filter files…" hideFilter={!filtering} />
        )}
      </Flex>
      {picked.size > 0 && (
        <Flex align="center" gap="2" px="3" py="2" flexShrink={0} borderTopWidth="1px" borderColor="border" bg="bg.subtle" role="toolbar" aria-label="Picked elements">
          <Text flex="1" minW="0" fontSize={textPx(12)} fontWeight="medium" truncate>
            {picked.size} selected
          </Text>
          <Button size="2xs" variant="ghost" onClick={() => setPicked(new Set())}>
            Clear
          </Button>
          <Button size="2xs" colorPalette="accent" onClick={addPicked} title="Add them to the diagram (⏎); or drag them onto it">
            Add to canvas <Kbd size="sm">⏎</Kbd>
          </Button>
        </Flex>
      )}
      <ContextMenu at={menu?.at ?? null} onClose={() => setMenu(null)} entries={menuEntries} title={menu?.node?.name} />
      {/* what was scanned, quietly */}
      <Flex align="center" h="28px" px="3" flexShrink={0} borderTopWidth="1px" borderColor="border.muted">
        <Text fontFamily="mono" fontSize={textPx(10.5)} color="fg.subtle" truncate>
          {snapshot.stats.files} files · {Object.keys(snapshot.nodes).length} el · types {snapshot.stats.types ? "✓" : "–"} · {Math.round(snapshot.stats.durationMs)}ms
        </Text>
      </Flex>
    </Panel>
  );
}
