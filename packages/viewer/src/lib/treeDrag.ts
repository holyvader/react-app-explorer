/** Tree rows dragged onto the canvas: the element ids, as JSON, under this type. */
export const TREE_DRAG_TYPE = "application/x-rae-ids";

/**
 * A small "+N" (or the element's name) under the pointer while rows are dragged, instead of the
 * browser's picture of the row. Removed once the drag has taken its image.
 */
export function setDragGhost(e: DragEvent, label: string) {
  if (!e.dataTransfer) return;
  const ghost = document.createElement("div");
  ghost.className = "rae-drag-ghost";
  ghost.textContent = label;
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, -8, -8);
  setTimeout(() => ghost.remove(), 0);
}
