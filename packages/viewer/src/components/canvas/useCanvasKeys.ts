import { useEffect, useState } from "react";
import { isFolder } from "../../graph/drawn.ts";
import { useExplorer } from "../../store.ts";

/*
 * The diagram's keyboard: Space adds, ⌘A selects all, ⌘Z / ⇧⌘Z undo / redo, Delete removes, Esc
 * closes what's open or clears the selection; and the held modifiers, for the cursor (⌘ / Ctrl /
 * Shift: a click adds to the selection; Shift: a drag draws a selection box).
 */

const isTyping = (t: EventTarget | null) =>
  !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true], [role=dialog], [role=menu]");

export function useCanvasKeys() {
  const setMenu = useExplorer.getState().openMenu;
  /** ⌘ / Ctrl / Shift held: a click adds to the selection (the cursor says so). */
  const [adding, setAdding] = useState(false);
  /** Shift held: a drag on empty space draws a selection box (crosshair). */
  const [boxing, setBoxing] = useState(false);

  // Keyboard shortcuts on the diagram.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useExplorer.getState();
      // Esc closes what's open (picker, quick add, menu) — even from inside it — else clears the selection.
      if (e.key === "Escape") {
        if (s.searchOpen || s.quickAdd || s.menu) {
          if (s.searchOpen) s.setSearchOpen(false);
          if (s.quickAdd) s.setQuickAdd(null);
          if (s.menu) setMenu(null);
        } else if (!isTyping(e.target)) s.select(undefined);
        return;
      }
      if (isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (e.key === " " && !mod && !e.repeat && s.snapshot) {
        e.preventDefault();
        s.setSearchOpen(true);
      } else if (mod && key === "a" && !e.altKey) {
        // Every element on the diagram — folders included.
        e.preventDefault();
        s.selectMany(s.placed.map((p) => p.element.id).filter((id) => isFolder(id) || !!s.snapshot?.nodes[id]));
      } else if (mod && !e.altKey && (key === "z" || key === "y")) {
        e.preventDefault();
        if (key === "z" && !e.shiftKey) s.undo();
        else s.redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !mod && s.selection.length) {
        e.preventDefault();
        s.hideNodes(s.selection);
      }
    };
    const onModifier = (e: KeyboardEvent) => {
      setAdding(e.metaKey || e.ctrlKey || e.shiftKey);
      setBoxing(e.shiftKey);
    };
    const onBlur = () => {
      setAdding(false);
      setBoxing(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onModifier);
    window.addEventListener("keyup", onModifier);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onModifier);
      window.removeEventListener("keyup", onModifier);
      window.removeEventListener("blur", onBlur);
    };
  }, [setMenu]);
  return { adding, boxing };
}
