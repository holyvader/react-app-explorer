import { Popover } from "@rae/design-system";
import { useCallback, useMemo, useRef } from "react";
import type { TreeNode } from "../../graph/tree.ts";
import { useExplorer } from "../../store.ts";
import { ElementTree } from "./ElementTree.tsx";

/**
 * Right-click on the empty canvas: the model's tree under a filter box, right there. A row clicked
 * (a folder too) puts that element on the diagram at that point. What's drawn already is left out — or greyed,
 * to be opened, when something inside it isn't (after noesis' quick add).
 */
export function QuickAdd() {
  const quick = useExplorer((s) => s.quickAdd);
  const visible = useExplorer((s) => s.visible);
  const { setQuickAdd, addNodes } = useExplorer.getState();
  const input = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => new Set(visible), [visible]);

  const graph = useExplorer((s) => s.graph);
  const onCanvas = useMemo(() => new Set(graph.elements.map((e) => e.id)), [graph]);
  const keep = useCallback((n: TreeNode) => !n.id || n.children.length > 0 || !shown.has(n.id), [shown]);
  const inactive = useCallback(
    (n: TreeNode) => ((n.id && shown.has(n.id)) || (n.kind === "folder" && onCanvas.has(n.key)) ? "on the diagram" : null),
    [shown, onCanvas],
  );

  return (
    <Popover
      open={!!quick}
      onOpenChange={(o) => !o && setQuickAdd(null)}
      at={quick?.at}
      placement="bottom-start"
      label="Add an element here"
      initialFocusEl={input}
      width="360px"
      height="min(420px, calc(100dvh - 120px))"
    >
      <ElementTree
        mode="pick"
        inputRef={input}
        keep={keep}
        inactive={inactive}
        placeholder="Add here: filter by name or path…"
        onActivate={(n) => {
          // folders are added by their id (`dir:<path>`), like any element
          const id = n.kind === "folder" ? n.key : n.id;
          if (!quick || !id) return;
          addNodes([id], { anchor: quick.anchor, select: id });
          setQuickAdd(null);
        }}
      />
    </Popover>
  );
}
