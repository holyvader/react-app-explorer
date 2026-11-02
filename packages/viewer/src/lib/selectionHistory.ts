/**
 * Back / Forward walk through the selected nodes: each newly selected node is a history entry;
 * going back selects (and shows) the previous one, adding it again if it was removed.
 *
 * Works the same in the browser and the desktop app: Back / Forward buttons on the canvas (the app's
 * web view has no browser toolbar) and ⌘[ / ⌘] in both; a browser's own Back / Forward too.
 */
import { useSyncExternalStore } from "react";
import { useExplorer } from "../store.ts";
import { serverIsDesktop } from "./api.ts";

/** `i`: the entry's position among the selection steps (0 = the first). */
type Entry = { rae: string | null; i: number };
const state = (): Partial<Entry> => (history.state as Partial<Entry> | null) ?? {};

// where we are, and how far Forward can go
let index = state().i ?? 0;
let last = index;
const listeners = new Set<() => void>();
const changed = () => {
  snapshot = { canBack: index > 0, canForward: index < last };
  for (const l of listeners) l();
};
let snapshot = { canBack: index > 0, canForward: index < last };

let navigating = false;

useExplorer.subscribe((s, prev) => {
  if (navigating || s.selectedId === prev.selectedId) return;
  // another snapshot: a fresh start, no stepping back into the old one's nodes
  if (s.snapshotName !== prev.snapshotName) {
    index = last = 0;
    history.replaceState({ rae: s.selectedId ?? null, i: 0 } satisfies Entry, "");
    return changed();
  }
  if (!s.selectedId || s.selectedId === state().rae) return; // clearing the selection isn't a step
  if (state().rae) {
    index += 1;
    last = index; // a new step drops what Forward had
    history.pushState({ rae: s.selectedId, i: index } satisfies Entry, "");
  } else {
    // the first selection takes over the page's own entry
    history.replaceState({ rae: s.selectedId, i: index } satisfies Entry, "");
  }
  changed();
});

window.addEventListener("popstate", (e) => {
  const entry = (e.state as Partial<Entry> | null) ?? {};
  index = entry.i ?? 0;
  last = Math.max(last, index);
  changed();
  const id = entry.rae;
  const s = useExplorer.getState();
  navigating = true;
  try {
    if (!id || (!s.snapshot?.nodes[id] && !id.startsWith("dir:"))) s.select(undefined);
    else s.addNodes([id], { select: id, focus: id });
  } finally {
    navigating = false;
  }
});

export const goBack = () => snapshot.canBack && history.back();
export const goForward = () => snapshot.canForward && history.forward();

/** Whether Back / Forward have somewhere to go (for the canvas buttons). */
export function useSelectionHistory() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

// ⌘[ / ⌘] (Ctrl elsewhere), handled here in both apps so they behave the same (the desktop app's
// web view has no such browser shortcut; in a browser this replaces its own Back / Forward keys)
window.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
  if ((e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable]")) return;
  if (e.key === "[") goBack();
  else if (e.key === "]") goForward();
  else return;
  e.preventDefault();
});
// desktop app only: the mouse's back / forward buttons (a browser already handles them itself)
window.addEventListener("mouseup", (e) => {
  if (!serverIsDesktop || (e.button !== 3 && e.button !== 4)) return;
  e.preventDefault();
  if (e.button === 3) goBack();
  else goForward();
});
