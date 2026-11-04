import { Button, Popover } from "@rae/design-system";
import { IconClose, IconPlus } from "@rae/design-system/icons";
import { useReactFlow } from "@xyflow/react";
import { useCallback, useMemo, useRef } from "react";
import type { TreeNode } from "../../graph/tree.ts";
import { folderExpansion, folderPath } from "../../graph/folder.ts";
import { isFiltered } from "../../graph/packages.ts";
import { relationFilterOf, useExplorer } from "../../store.ts";
import { ElementTree, type TickState } from "./ElementTree.tsx";

/**
 * What the diagram draws, chosen in one place: the scanned
 * model's tree, each element ticked in or out. A file row cycles: the file → with everything it
 * declares → off. Opens from the round plus at the canvas's foot, Space, ⌘K or "Start exploration".
 */
export function ExplorationPicker() {
  const open = useExplorer((s) => s.searchOpen);
  const snapshot = useExplorer((s) => s.snapshot);
  const visible = useExplorer((s) => s.visible);
  const excluded = useExplorer((s) => s.excluded);
  const hideAll = useExplorer((s) => s.hideAllLibraries);
  const showAssets = useExplorer((s) => s.showAssets);
  const diffOverlay = useExplorer((s) => s.diffOverlay);
  const { setSearchOpen, addNodes, hideNode, clear, requestAdd } = useExplorer.getState();
  const input = useRef<HTMLInputElement>(null);
  const flow = useReactFlow();

  const shown = useMemo(() => new Set(visible), [visible]);
  const total = useMemo(() => {
    if (!snapshot) return 0;
    const f = relationFilterOf({ enabled: { imports: true, declares: true, renders: true, hooks: true, invokes: true, types: true, navigation: true, cache: true }, excluded, hideAllLibraries: hideAll, showAssets, diffOverlay });
    return Object.values(snapshot.nodes).filter((n) => !n.id.startsWith("asset:") && !isFiltered(n, f.libraries)).length;
  }, [snapshot, excluded, hideAll, showAssets, diffOverlay]);

  const graph = useExplorer((s) => s.graph);
  const onCanvas = useMemo(() => new Set(graph.elements.map((e) => e.id)), [graph]);
  const tickOf = useCallback(
    (n: TreeNode): TickState | null => {
      if (n.kind === "folder") {
        // drawn? and is every file inside drawn too?
        if (!onCanvas.has(n.key)) return "off";
        const files = snapshot ? folderExpansion(snapshot, folderPath(n.key), false) : [];
        return files.every((f) => shown.has(f)) ? "all" : "file";
      }
      if (n.kind === "decl" || n.kind === "library") return shown.has(n.id!) ? "on" : "off";
      if (n.kind !== "file") return null;
      const inside = n.children.filter((c) => shown.has(c.id!)).length;
      if (!shown.has(n.id!)) return inside ? "partial" : "off";
      return inside === n.children.length ? "all" : "file";
    },
    [shown, onCanvas, snapshot],
  );

  // New elements go near the middle of what the user is looking at.
  const anchor = () => {
    const box = document.querySelector(".rae-canvas")?.getBoundingClientRect();
    return box ? flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 }) : null;
  };

  const onActivate = (n: TreeNode) => {
    if (n.kind === "folder") {
      // Once: the folder. Again: with the files inside. Once more: off (with what's inside).
      const state = tickOf(n);
      if (state === "off") addNodes([n.key], { anchor: anchor() });
      else if (state === "file") useExplorer.getState().expandFolder(n.key, false);
      else hideNode(n.key);
      return;
    }
    const id = n.id!;
    if (n.kind === "file") {
      // Once: the file. Again: with all inside it. Once more: off.
      const state = tickOf(n);
      if (!shown.has(id)) addNodes([id], { anchor: anchor() });
      else if (state !== "all") addNodes(n.children.map((c) => c.id!), { anchor: id, fit: true });
      else hideNode(id);
      return;
    }
    if (shown.has(id)) hideNode(id);
    else addNodes([id], { anchor: anchor() });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => setSearchOpen(o)}
      label="Add to the diagram"
      placement="top"
      initialFocusEl={input}
      height="min(560px, calc(100dvh - 200px))"
      trigger={
        <div className="rae-add-anchor">
          {visible.length > 0 && (
            <button type="button" className="rae-add-plus" aria-label={open ? "Close" : "Add to the diagram"} title={open ? "Close" : "Add to the diagram (Space)"}>
              {open ? <IconClose size={24} /> : <IconPlus size={24} />}
            </button>
          )}
        </div>
      }
    >
      <ElementTree mode="toggle" onActivate={onActivate} tickOf={tickOf} inputRef={input} />
      <div className="rae-picker-foot">
        <span style={{ flex: 1 }}>Click once to draw, again for all inside a file or folder, once more to take them off.</span>
        <output>
          <b>{visible.length}</b> of {total} drawn
        </output>
        <Button size="xs" variant="outline" disabled={visible.length >= total} onClick={() => requestAdd(Object.keys(snapshot?.nodes ?? {}).filter((id) => !id.startsWith("asset:")), "All elements")}>
          Add all
        </Button>
        <Button size="xs" variant="outline" disabled={!visible.length} onClick={() => clear()}>
          Clear
        </Button>
        <Button size="xs" colorPalette="accent" onClick={() => setSearchOpen(false)}>
          Done
        </Button>
      </div>
    </Popover>
  );
}
