/**
 * The browser's Back / Forward walk through the selected nodes: each newly selected node is a
 * history entry; going back selects (and shows) the previous one, adding it again if it was removed.
 *
 * The desktop app's web view has no Back button, so there the mouse's back / forward buttons and
 * ⌘[ / ⌘] (Ctrl on other systems) do the same.
 */
import { useExplorer } from "../store.ts";
import { serverIsDesktop } from "./api.ts";

type Entry = { rae: string | null };
const current = (): string | null | undefined => (history.state as Entry | null)?.rae;

let navigating = false;

useExplorer.subscribe((s, prev) => {
  if (navigating || s.selectedId === prev.selectedId) return;
  // another snapshot: a fresh start, no stepping back into the old one's nodes
  if (s.snapshotName !== prev.snapshotName) return history.replaceState({ rae: s.selectedId ?? null } satisfies Entry, "");
  if (!s.selectedId || s.selectedId === current()) return; // clearing the selection isn't a step
  // the first selection takes over the page's own entry; later ones add entries
  if (current()) history.pushState({ rae: s.selectedId } satisfies Entry, "");
  else history.replaceState({ rae: s.selectedId } satisfies Entry, "");
});

window.addEventListener("popstate", (e) => {
  const id = (e.state as Entry | null)?.rae;
  const s = useExplorer.getState();
  navigating = true;
  try {
    if (!id || (!s.snapshot?.nodes[id] && !id.startsWith("dir:"))) s.select(undefined);
    else s.addNodes([id], { select: id, focus: id });
  } finally {
    navigating = false;
  }
});

// desktop app: back / forward from the mouse buttons and the keyboard
window.addEventListener("mouseup", (e) => {
  if (!serverIsDesktop || (e.button !== 3 && e.button !== 4)) return;
  e.preventDefault();
  if (e.button === 3) history.back();
  else history.forward();
});
window.addEventListener("keydown", (e) => {
  if (!serverIsDesktop || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
  if ((e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable]")) return;
  if (e.key === "[") history.back();
  else if (e.key === "]") history.forward();
  else return;
  e.preventDefault();
});
