import { Button, Popover } from "@rae/design-system";
import { useReactFlow } from "@xyflow/react";
import { useCallback, useMemo, useRef } from "react";
import type { TreeNode } from "../../graph/tree.ts";
import { folderExpansion, folderPath } from "../../graph/folder.ts";
import { isFiltered } from "../../graph/packages.ts";
import { useExplorer, useRelationFilter } from "../../store.ts";
import { ElementTree, type TickState } from "./ElementTree.tsx";
import { matchingScripts, useScripts } from "../../lib/scripts.ts";
import { ScriptCommands } from "../scripts/ScriptCommands.tsx";

/**
 * What the diagram draws, chosen in one place: the scanned
 * model's tree, each element ticked in or out. A file row cycles: the file → with everything it
 * declares → off. Opens from the round plus at the canvas's foot, Space, ⌘K or "Start exploration".
 */
export function ExplorationPicker() {
  const open = useExplorer((s) => s.searchOpen);
  // a right-click on empty space: open there, and put what's ticked at that point
  const at = useExplorer((s) => s.searchAt);
  const searchAnchor = useExplorer((s) => s.searchAnchor);
  const snapshot = useExplorer((s) => s.snapshot);
  const visible = useExplorer((s) => s.visible);
  const filter = useRelationFilter({ allGroups: true });
  const { setSearchOpen, addNodes, hideNode, clear, requestAdd } = useExplorer.getState();
  const input = useRef<HTMLInputElement>(null);
  const flow = useReactFlow();

  const shown = useMemo(() => new Set(visible), [visible]);
  const total = useMemo(() => {
    if (!snapshot) return 0;
    return Object.values(snapshot.nodes).filter((n) => !n.id.startsWith("asset:") && !isFiltered(n, filter.libraries)).length;
  }, [snapshot, filter]);

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

  // New elements go where the canvas was right-clicked, else near the middle of what the user is looking at.
  const anchor = () => {
    if (searchAnchor) return searchAnchor;
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
      else if (state !== "all") requestAdd(n.children.map((c) => c.id!), `Everything in ${n.name}`, id);
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
      placement={at ? "bottom-start" : "top"}
      at={at}
      initialFocusEl={input}
      height="min(560px, calc(100dvh - 200px))"
      // opens above the canvas's bottom centre (Space, ⌘K, "Start exploration"); no button there: the
      // status bar and the empty diagram say a right-click on empty space adds an element
      trigger={<div className="rae-add-anchor" aria-hidden />}
    >
      <ElementTree
        mode="toggle"
        onActivate={onActivate}
        tickOf={tickOf}
        inputRef={input}
        placeholder="Filter by name or path… (> runs a script)"
        commands={{
          prefix: ">",
          render: (term) => <ScriptCommands term={term} onRun={() => setSearchOpen(false)} />,
          run: (term) => {
            const { info, run } = useScripts.getState();
            const first = info && matchingScripts(term, info.scripts)[0];
            if (!first) return false;
            void run(first);
            setSearchOpen(false);
            return true;
          },
        }}
      />
      <div className="rae-picker-hint">Click to add · again for all inside · once more to remove</div>
      <div className="rae-picker-foot">
        <output style={{ flex: 1 }}>
          <b>{visible.length}</b> of {total} drawn
        </output>
        <Button size="xs" variant="outline" disabled={visible.length >= total} onClick={() => requestAdd(Object.keys(snapshot?.nodes ?? {}).filter((id) => !id.startsWith("asset:") && !isFiltered(snapshot!.nodes[id], filter.libraries)), "All elements")}>
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
